import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { StageConfig } from './config';

export const WEBEX_CONNECTOR_ECR_REPO = 'ccc-webex-connector';

interface WebexConnectorStackProps extends StackProps {
  config: StageConfig;
  vpc: ec2.Vpc;
  /** ECR image tag to run; defaults to 'latest'. */
  imageTag?: string;
}

/**
 * Shared infra for the hosted per-tenant Webex connector (Phase E): one ECS
 * cluster, one Fargate task *definition* registered once, and one internet-
 * facing ALB. The task definition and ALB are shared across every tenant —
 * what's per-tenant (a service, a target group, a listener rule, SSM
 * secrets) is provisioned dynamically at runtime by the portal backend
 * (app/services/webex_connector.py), not by CDK. This stack only stands up
 * the reusable scaffolding those runtime calls attach to.
 */
export class WebexConnectorStack extends Stack {
  public readonly cluster: ecs.Cluster;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly taskDefinitionFamily: string;
  public readonly listener: elbv2.ApplicationListener;
  public readonly subnetIds: string[];
  public readonly securityGroupIds: string[];
  public readonly domain: string;

  constructor(scope: Construct, id: string, props: WebexConnectorStackProps) {
    super(scope, id, props);
    const { config, vpc } = props;
    this.domain = `webex-connector-origin.${config.domainName}`;

    this.cluster = new ecs.Cluster(this, 'Cluster', { vpc });
    this.taskDefinitionFamily = `ccc-${config.stageName}-webex-connector`;

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'Task', {
      family: this.taskDefinitionFamily,
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Self-discovery (config.py): read the tenant_id tag off its own task via
    // ECS, then fetch its own secrets from SSM under the shared prefix.
    this.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:ListTagsForResource', 'ecs:DescribeTasks'],
        resources: ['*'],
      }),
    );
    this.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${config.env.region}:${config.env.account}:parameter/ccc/${config.stageName}/webex-connector/*`,
        ],
      }),
    );
    // The connector process itself calls SSM with WithDecryption=True, so
    // decrypt belongs on the task role (the execution role only pulls images
    // and resolves task-definition secrets).
    this.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: { StringEquals: { 'kms:ViaService': `ssm.${config.env.region}.amazonaws.com` } },
      }),
    );
    this.taskDefinition.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: { StringEquals: { 'kms:ViaService': `ssm.${config.env.region}.amazonaws.com` } },
      }),
    );

    const repo = ecr.Repository.fromRepositoryName(this, 'Repo', WEBEX_CONNECTOR_ECR_REPO);
    const image = ecs.ContainerImage.fromEcrRepository(repo, props.imageTag ?? 'latest');

    this.taskDefinition.addContainer('webex-connector', {
      image,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'webex-connector', logGroup }),
      portMappings: [{ containerPort: 8080 }],
      environment: {
        SSM_PREFIX: `/ccc/${config.stageName}/webex-connector`,
        PORTAL_URL: `https://${config.domainName}`,
        AWS_REGION: config.env.region,
      },
    });

    const sg = new ec2.SecurityGroup(this, 'ServiceSg', { vpc, allowAllOutbound: true });
    this.securityGroupIds = [sg.securityGroupId];
    // Dev intentionally has no NAT gateway. Connector tasks need outbound
    // internet access to Webex, the portal, ECR, and SSM.
    this.subnetIds = vpc.publicSubnets.map((s) => s.subnetId);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.zoneName,
    });
    const cert = new acm.Certificate(this, 'Cert', {
      domainName: this.domain,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    sg.addIngressRule(alb.connections.securityGroups[0], ec2.Port.tcp(8080));

    this.listener = alb.addListener('Https', {
      port: 443,
      certificates: [cert],
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'Not found',
      }),
    });

    new route53.ARecord(this, 'OriginRecord', {
      zone,
      recordName: 'webex-connector-origin',
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
    });
  }
}
