import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { StageConfig, BACKEND_ECR_REPO, webBucketName } from './config';
import { WebexConnectorStack } from './webex-connector-stack';

interface AppStackProps extends StackProps {
  config: StageConfig;
  vpc: ec2.Vpc;
  dbCluster: rds.DatabaseCluster;
  mediaBucket: s3.Bucket;
  /** Shared per-tenant Webex connector infra (cluster/task-def/ALB) the
   * backend dynamically attaches per-tenant services/secrets to at runtime. */
  webexConnector: WebexConnectorStack;
  /** ECR image tag to run. CI passes the commit SHA; defaults to 'latest'. */
  imageTag?: string;
}

/**
 * The runtime plane: a single Fargate (Spot) backend task behind an internet-
 * facing ALB, a CloudFront distribution that serves the static SPA from S3 and
 * proxies /api/* (incl. WebSocket) to the ALB, a Cognito user pool for SSO, and
 * the ACM cert + Route53 records tying it to dev.cloudcorecollab.com.
 */
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { config, vpc, dbCluster, mediaBucket, webexConnector } = props;
    const domain = config.domainName;
    const apiOrigin = `api-origin.${domain}`;

    // Static SPA bucket lives here (with CloudFront) to avoid a cross-stack OAC
    // policy cycle. Ephemeral/rebuildable, so destroy-on-teardown is fine.
    const webBucket = new s3.Bucket(this, 'Web', {
      bucketName: webBucketName(config),
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.zoneName,
    });

    // One us-east-1 cert covering the CloudFront alias and the ALB origin host.
    const cert = new acm.Certificate(this, 'Cert', {
      domainName: domain,
      subjectAlternativeNames: [apiOrigin],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    // Auth is via server-side Webex/Zoom OAuth (see app/api/oauth.py) plus local
    // users. No Cognito. Provider client id/secret come from SSM at runtime.

    // ---- ECS backend service --------------------------------------------------
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
    const logGroup = new logs.LogGroup(this, 'BackendLogs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: config.task.cpu,
      memoryLimitMiB: config.task.memoryMiB,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64, // GitHub runners build amd64
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    mediaBucket.grantReadWrite(taskDef.taskRole);

    // ecs.Secret.fromSsmParameter grants ssm:GetParameters but not kms:Decrypt
    // for the default aws/ssm key, so the task can't pull SecureString secrets
    // without this. Scoped to decrypt-via-SSM in this region only.
    taskDef.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: { StringEquals: { 'kms:ViaService': `ssm.${config.env.region}.amazonaws.com` } },
      }),
    );

    // Per-tenant hosted Webex connector orchestration (app/services/
    // webex_connector.py): the backend dynamically creates/deletes one ECS
    // service, ALB target group, listener rule, and SSM secret pair per
    // tenant on the shared cluster/task-def/ALB stood up by WebexConnectorStack.
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'ecs:CreateService',
          'ecs:UpdateService',
          'ecs:DeleteService',
          'ecs:DescribeServices',
        ],
        resources: ['*'],
        conditions: { StringEquals: { 'ecs:cluster': webexConnector.cluster.clusterArn } },
      }),
    );
    // ecs:CreateService passes both roles from the shared connector task
    // definition to ECS. The backend task must be allowed to pass them.
    webexConnector.taskDefinition.taskRole.grantPassRole(taskDef.taskRole);
    webexConnector.taskDefinition.executionRole?.grantPassRole(taskDef.taskRole);
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'elasticloadbalancing:CreateTargetGroup',
          'elasticloadbalancing:DeleteTargetGroup',
          'elasticloadbalancing:DescribeTargetGroups',
          'elasticloadbalancing:CreateRule',
          'elasticloadbalancing:DeleteRule',
          'elasticloadbalancing:DescribeRules',
          'elasticloadbalancing:DescribeListeners',
          'elasticloadbalancing:DescribeLoadBalancers',
        ],
        resources: ['*'],
      }),
    );
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:PutParameter', 'ssm:DeleteParameter', 'ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${config.env.region}:${config.env.account}:parameter/ccc/${config.stageName}/webex-connector/*`,
        ],
      }),
    );

    const repo = ecr.Repository.fromRepositoryName(this, 'BackendRepo', BACKEND_ECR_REPO);
    const image = ecs.ContainerImage.fromEcrRepository(repo, props.imageTag ?? 'latest');

    const dbSecret = dbCluster.secret!;
    const secure = (cid: string, name: string) =>
      ecs.Secret.fromSsmParameter(
        ssm.StringParameter.fromSecureStringParameterAttributes(this, cid, { parameterName: name }),
      );

    taskDef.addContainer('backend', {
      image,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'backend', logGroup }),
      portMappings: [{ containerPort: 8000 }],
      environment: {
        STORAGE_BACKEND: 's3',
        S3_BUCKET: mediaBucket.bucketName,
        S3_REGION: config.env.region,
        TRANSCRIPTION_ENABLED: 'false',
        FREESWITCH_FS_CLI: '',
        SYSTEM_CONTAINERS: '',
        CORS_ORIGINS: `https://${domain}`,
        RETENTION_SWEEP_INTERVAL_S: '3600',
        DB_POOL_MODE: 'nullpool',
        DB_NAME: 'portal',
        OIDC_ENABLED: 'false',
        PUBLIC_BASE_URL: `https://${domain}`,
        ADMIN_EMAIL: config.alarmEmail,
        // Hosted per-tenant Webex connector: identifiers only (not secrets) —
        // the actual per-tenant secrets live under WEBEX_CONNECTOR_SSM_PREFIX.
        WEBEX_CONNECTOR_REGION: config.env.region,
        WEBEX_CONNECTOR_CLUSTER_ARN: webexConnector.cluster.clusterArn,
        WEBEX_CONNECTOR_TASK_DEFINITION_ARN: webexConnector.taskDefinition.taskDefinitionArn,
        WEBEX_CONNECTOR_CONTAINER_NAME: 'webex-connector',
        WEBEX_CONNECTOR_LISTENER_ARN: webexConnector.listener.listenerArn,
        WEBEX_CONNECTOR_SUBNET_IDS: webexConnector.subnetIds.join(','),
        WEBEX_CONNECTOR_SECURITY_GROUP_IDS: webexConnector.securityGroupIds.join(','),
        WEBEX_CONNECTOR_DOMAIN: webexConnector.domain,
        WEBEX_CONNECTOR_SSM_PREFIX: `/ccc/${config.stageName}/webex-connector`,
      },
      secrets: {
        DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
        DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
        DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        JWT_SECRET: secure('JwtParam', '/ccc/dev/jwt_secret'),
        INGEST_TOKEN: secure('IngestParam', '/ccc/dev/ingest_token'),
        WORKER_TOKEN: secure('WorkerParam', '/ccc/dev/worker_token'),
        ADMIN_PASSWORD: secure('AdminPwParam', '/ccc/dev/admin_password'),
        // OAuth provider credentials (placeholders until you register the apps).
        // Update the SSM values + force a new ECS deployment to enable a provider.
        WEBEX_CLIENT_ID: secure('WebexIdParam', '/ccc/dev/webex_client_id'),
        WEBEX_CLIENT_SECRET: secure('WebexSecretParam', '/ccc/dev/webex_client_secret'),
        ZOOM_CLIENT_ID: secure('ZoomIdParam', '/ccc/dev/zoom_client_id'),
        ZOOM_CLIENT_SECRET: secure('ZoomSecretParam', '/ccc/dev/zoom_client_secret'),
        // Webex Service App: the admin-consent org integration (separate from
        // the per-user OAuth login above). Placeholders until the app is
        // registered per docs/webex-service-app.md.
        WEBEX_SERVICEAPP_ID: secure('WebexServiceAppIdParam', '/ccc/dev/webex_serviceapp_id'),
        WEBEX_SERVICEAPP_CLIENT_ID: secure(
          'WebexServiceAppClientIdParam',
          '/ccc/dev/webex_serviceapp_client_id',
        ),
        WEBEX_SERVICEAPP_CLIENT_SECRET: secure(
          'WebexServiceAppClientSecretParam',
          '/ccc/dev/webex_serviceapp_client_secret',
        ),
        WEBEX_SERVICEAPP_WEBHOOK_SECRET: secure(
          'WebexServiceAppWebhookSecretParam',
          '/ccc/dev/webex_serviceapp_webhook_secret',
        ),
        WEBEX_SERVICEAPP_ORG_TOKEN: secure(
          'WebexServiceAppOrgTokenParam',
          '/ccc/dev/webex_serviceapp_org_token',
        ),
        CRYPTO_KEY: secure('CryptoKeyParam', '/ccc/dev/crypto_key'),
      },
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: config.task.desiredCount,
      assignPublicIp: true, // no NAT; task reaches ECR/Secrets/S3 via the IGW
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      capacityProviderStrategies: [
        { capacityProvider: config.task.spot ? 'FARGATE_SPOT' : 'FARGATE', weight: 1 },
      ],
      minHealthyPercent: 0, // stop old task before new → migrations never race
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(120),
    });
    // Allow the backend task into Aurora. Declared here (rather than
    // dbCluster.connections.allowDefaultPortFrom) so the rule lives in THIS
    // stack — otherwise the data stack would reference the app SG and create an
    // app<->data dependency cycle. Keeps the already-deployed data stack intact.
    new ec2.CfnSecurityGroupIngress(this, 'AuroraIngressFromApp', {
      groupId: dbCluster.connections.securityGroups[0].securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      sourceSecurityGroupId: service.connections.securityGroups[0].securityGroupId,
      description: 'ECS backend to Aurora',
    });

    // ---- ALB ------------------------------------------------------------------
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    alb.setAttribute('idle_timeout.timeout_seconds', '300'); // survive WS idle

    const listener = alb.addListener('Https', {
      port: 443,
      certificates: [cert],
      // NOTE: origin-verify header check deferred — the ALB is reachable directly
      // but every real route requires auth (only /api/health is public). Add a
      // CloudFront custom-header + rule condition here when hardening for prod.
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Forbidden',
      }),
    });
    listener.addTargets('Backend', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.hostHeaders([apiOrigin])],
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/api/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
      },
      deregistrationDelay: Duration.seconds(10),
    });

    new route53.ARecord(this, 'ApiOriginRecord', {
      zone,
      recordName: 'api-origin',
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
    });

    // ---- CloudFront -----------------------------------------------------------
    // SPA routing is done with a CloudFront Function on the default (S3) behavior
    // only — extensionless paths are rewritten to /index.html. We deliberately do
    // NOT use distribution-wide errorResponses (403/404 -> index.html): those are
    // global and would rewrite genuine /api/* 403/404 responses into 200 HTML,
    // masking real API errors from the client.
    const spaRouter = new cloudfront.Function(this, 'SpaRouter', {
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event){var r=event.request;if(r.uri.indexOf('.')===-1){r.uri='/index.html';}return r;}",
      ),
    });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      domainNames: [domain],
      certificate: cert,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          { function: spaRouter, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiOrigin, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            readTimeout: Duration.seconds(60),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    new route53.ARecord(this, 'CdnRecord', {
      zone,
      recordName: '', // apex of the delegated zone: dev.cloudcorecollab.com
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new CfnOutput(this, 'PortalUrl', { value: `https://${domain}` });
    new CfnOutput(this, 'WebBucketName', { value: webBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'AlbDnsName', { value: alb.loadBalancerDnsName });
  }
}
