/**
 * Per-stage configuration for the ccc-recording-portal AWS deployment.
 *
 * `dev` is live today (dev.cloudcorecollab.com). `prod` is a stub to be filled
 * in once dev is accepted — it will use NAT + private subnets, on-demand Fargate
 * ×2, a non-zero Aurora ACU floor, and gated deploys (see plan "Prod notes").
 */

export interface StageConfig {
  readonly stageName: 'dev' | 'prod';
  readonly env: { account: string; region: string };
  /** Full public hostname served to users, e.g. dev.cloudcorecollab.com */
  readonly domainName: string;
  /** Route53 public hosted zone (the delegated subdomain zone) */
  readonly hostedZoneId: string;
  readonly zoneName: string;
  /** GitHub "owner/repo" trusted by the CI OIDC deploy role */
  readonly githubRepo: string;
  readonly githubBranch: string;
  readonly db: {
    /** 0 enables Aurora Serverless v2 auto-pause (scale to zero) */
    readonly minCapacity: number;
    readonly maxCapacity: number;
    readonly autoPauseMinutes: number;
  };
  readonly task: {
    readonly cpu: number;
    readonly memoryMiB: number;
    readonly desiredCount: number;
    /** Use Fargate Spot capacity provider (dev only) */
    readonly spot: boolean;
  };
  readonly alarmEmail: string;
  /** When set, reuse an existing ACM cert for auth.<domain> (avoids orphan certs on rollback). */
  readonly authCertificateArn?: string;
}

/** Deterministic, globally-unique S3 bucket names so CI and IAM can target them by name. */
export const webBucketName = (c: StageConfig): string =>
  `ccc-${c.stageName}-web-${c.env.account}`;
export const mediaBucketName = (c: StageConfig): string =>
  `ccc-${c.stageName}-media-${c.env.account}`;

export const BACKEND_ECR_REPO = 'ccc-portal-backend';

export const STAGES: Record<string, StageConfig> = {
  dev: {
    stageName: 'dev',
    env: { account: '765366202604', region: 'us-east-1' },
    domainName: 'dev.cloudcorecollab.com',
    hostedZoneId: 'Z08421333RVS223F6L5S9',
    zoneName: 'dev.cloudcorecollab.com',
    githubRepo: 'jmetdev/ccc-recording-portal',
    githubBranch: 'main',
    db: { minCapacity: 0, maxCapacity: 2, autoPauseMinutes: 15 },
    task: { cpu: 512, memoryMiB: 1024, desiredCount: 1, spot: true },
    alarmEmail: 'jeffmetcalf@gmail.com',
    authCertificateArn:
      'arn:aws:acm:us-east-1:765366202604:certificate/55b69b3f-ba61-4211-bb79-64aaa0a55494',
  },
};
