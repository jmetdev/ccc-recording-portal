import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { StageConfig, mediaBucketName } from './config';

interface DataStackProps extends StackProps {
  config: StageConfig;
  vpc: ec2.Vpc;
}

/**
 * Durable data plane: Aurora Serverless v2 (PostgreSQL 16 + pgvector) and the
 * media bucket. Kept in its own stack so tearing down the app never touches the
 * database or recorded media. (The web/SPA bucket lives in the app stack,
 * colocated with its CloudFront distribution to avoid a cross-stack OAC cycle.)
 */
export class DataStack extends Stack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly mediaBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config, vpc } = props;
    const isProd = config.stageName === 'prod';

    // ---- Aurora Serverless v2 (PostgreSQL 16) ---------------------------------
    // min capacity 0 => auto-pauses when idle (needs engine >= 16.3). The backend
    // uses NullPool in the cloud so no idle pooled connection keeps it awake.
    this.cluster = new rds.DatabaseCluster(this, 'Aurora', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_6,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      writer: rds.ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: config.db.minCapacity,
      serverlessV2MaxCapacity: config.db.maxCapacity,
      serverlessV2AutoPauseDuration:
        config.db.minCapacity === 0 ? Duration.minutes(config.db.autoPauseMinutes) : undefined,
      credentials: rds.Credentials.fromGeneratedSecret('portal', { secretName: `ccc-${config.stageName}-db` }),
      defaultDatabaseName: 'portal',
      storageEncrypted: true,
      backup: { retention: Duration.days(isProd ? 7 : 1) },
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // ---- Media bucket (recordings) --------------------------------------------
    // Private; served only via API presigned URLs. CORS lets the SPA follow the
    // 307 redirect and Range-scrub audio cross-origin from the CloudFront domain.
    this.mediaBucket = new s3.Bucket(this, 'Media', {
      bucketName: mediaBucketName(config),
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: [`https://${config.domainName}`],
          allowedHeaders: ['*'],
          exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type', 'ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new CfnOutput(this, 'DbSecretArn', { value: this.cluster.secret!.secretArn });
    new CfnOutput(this, 'MediaBucketName', { value: this.mediaBucket.bucketName });
  }
}
