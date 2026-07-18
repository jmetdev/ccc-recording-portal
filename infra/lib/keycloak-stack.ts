import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { StageConfig } from './config';

export const KEYCLOAK_ECR_REPO = 'ccc-keycloak';

interface KeycloakStackProps extends StackProps {
  config: StageConfig;
  vpc: ec2.Vpc;
  dbCluster: rds.DatabaseCluster;
  /** ECR image tag to run; defaults to 'latest'. */
  imageTag?: string;
}

/**
 * Shared Keycloak for cross-app SSO (Phase D): one realm brokers Webex login
 * for both ccc-recording-portal and CloudCoreFax. Attached to the portal ALB
 * at auth.<stage-domain> (priority 30).
 */
export class KeycloakStack extends Stack {
  public readonly authDomain: string;

  constructor(scope: Construct, id: string, props: KeycloakStackProps) {
    super(scope, id, props);
    const { config, vpc, dbCluster } = props;
    this.authDomain = `auth.${config.domainName}`;

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.zoneName,
    });

    const alb = elbv2.ApplicationLoadBalancer.fromLookup(this, 'SharedAlb', {
      loadBalancerTags: { project: 'ccc-recording-portal', stage: config.stageName },
    });
    const listener = elbv2.ApplicationListener.fromLookup(this, 'SharedListener', {
      loadBalancerArn: alb.loadBalancerArn,
      listenerPort: 443,
      listenerProtocol: elbv2.ApplicationProtocol.HTTPS,
    });

    const cert = new acm.Certificate(this, 'Cert', {
      domainName: this.authDomain,
      validation: acm.CertificateValidation.fromDns(zone),
    });
    new elbv2.ApplicationListenerCertificate(this, 'AuthSni', {
      listener,
      certificates: [elbv2.ListenerCertificate.fromCertificateManager(cert)],
    });

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    taskDef.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: { StringEquals: { 'kms:ViaService': `ssm.${config.env.region}.amazonaws.com` } },
      }),
    );

    const dbSecret = dbCluster.secret!;
    const secure = (cid: string, name: string) =>
      ecs.Secret.fromSsmParameter(
        ssm.StringParameter.fromSecureStringParameterAttributes(this, cid, { parameterName: name }),
      );

    const repo = ecr.Repository.fromRepositoryName(this, 'Repo', KEYCLOAK_ECR_REPO);
    const image = ecs.ContainerImage.fromEcrRepository(repo, props.imageTag ?? 'latest');

    const dbHost = ecs.Secret.fromSecretsManager(dbSecret, 'host');
    const dbPort = ecs.Secret.fromSecretsManager(dbSecret, 'port');
    const dbUser = ecs.Secret.fromSecretsManager(dbSecret, 'username');
    const dbPassword = ecs.Secret.fromSecretsManager(dbSecret, 'password');

    const schemaInit = taskDef.addContainer('db-schema-init', {
      image: ecs.ContainerImage.fromRegistry('postgres:16-alpine'),
      essential: false,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'schema-init', logGroup }),
      command: [
        'sh',
        '-c',
        'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d portal -c "CREATE SCHEMA IF NOT EXISTS keycloak"',
      ],
      secrets: {
        DB_HOST: dbHost,
        DB_PORT: dbPort,
        DB_USER: dbUser,
        DB_PASSWORD: dbPassword,
      },
    });

    const keycloak = taskDef.addContainer('keycloak', {
      image,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'keycloak', logGroup }),
      portMappings: [{ containerPort: 8080 }],
      environment: {
        KC_DB: 'postgres',
        KC_BOOTSTRAP_ADMIN_USERNAME: 'admin',
        KC_DB_URL_DATABASE: 'portal',
        KC_DB_SCHEMA: 'keycloak',
        KC_HTTP_ENABLED: 'true',
        KC_PROXY_HEADERS: 'xforwarded',
        KC_HOSTNAME: `https://${this.authDomain}`,
        KC_HOSTNAME_STRICT: 'false',
        KC_HEALTH_ENABLED: 'true',
        KC_CACHE: 'local',
      },
      secrets: {
        KC_DB_URL_HOST: dbHost,
        KC_DB_URL_PORT: dbPort,
        KC_DB_USERNAME: dbUser,
        KC_DB_PASSWORD: dbPassword,
        KC_BOOTSTRAP_ADMIN_PASSWORD: secure('KcAdminPwParam', `/ccc/${config.stageName}/keycloak_admin_password`),
      },
    });
    keycloak.addContainerDependencies({
      container: schemaInit,
      condition: ecs.ContainerDependencyCondition.SUCCESS,
    });

    const serviceSg = new ec2.SecurityGroup(this, 'ServiceSg', {
      vpc,
      description: 'Keycloak behind shared ALB',
      allowAllOutbound: true,
    });
    const albSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'AlbSg',
      listener.connections.securityGroups[0].securityGroupId,
      { mutable: true },
    );
    serviceSg.addIngressRule(albSg, ec2.Port.tcp(8080), 'ALB to Keycloak');

    new ec2.CfnSecurityGroupIngress(this, 'AuroraIngressFromKeycloak', {
      groupId: dbCluster.connections.securityGroups[0].securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      sourceSecurityGroupId: serviceSg.securityGroupId,
      description: 'Keycloak to Aurora',
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [serviceSg],
      capacityProviderStrategies: [
        { capacityProvider: config.task.spot ? 'FARGATE_SPOT' : 'FARGATE', weight: 1 },
      ],
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(300),
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'Tg', {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [service.loadBalancerTarget({ containerName: 'keycloak', containerPort: 8080 })],
      healthCheck: {
        path: '/health/ready',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(10),
      },
      deregistrationDelay: Duration.seconds(30),
    });
    new elbv2.ApplicationListenerRule(this, 'AuthRule', {
      listener,
      priority: 30,
      conditions: [elbv2.ListenerCondition.hostHeaders([this.authDomain])],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });
    new ec2.CfnSecurityGroupEgress(this, 'AlbEgressToKeycloak', {
      groupId: albSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 8080,
      toPort: 8080,
      destinationSecurityGroupId: serviceSg.securityGroupId,
      description: 'ALB to Keycloak',
    });

    new route53.ARecord(this, 'AuthRecord', {
      zone,
      recordName: 'auth',
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
    });

    new CfnOutput(this, 'AuthUrl', { value: `https://${this.authDomain}` });
    new CfnOutput(this, 'OidcIssuer', { value: `https://${this.authDomain}/realms/ccc` });
  }
}
