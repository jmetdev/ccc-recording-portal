import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { StageConfig, webBucketName, BACKEND_ECR_REPO } from './config';
import { WEBEX_CONNECTOR_ECR_REPO } from './webex-connector-stack';
import { KEYCLOAK_ECR_REPO } from './keycloak-stack';

interface CiStackProps extends StackProps {
  config: StageConfig;
}

/**
 * CI/CD plumbing: the backend ECR repo, a GitHub OIDC identity provider, and a
 * keyless deploy role that GitHub Actions assumes (no long-lived AWS keys).
 * The role can push images, sync the web bucket, invalidate CloudFront, and
 * assume the CDK deploy roles so `cdk deploy` does the rest via CloudFormation.
 */
export class CiStack extends Stack {
  public readonly repo: ecr.Repository;
  public readonly webexConnectorRepo: ecr.Repository;
  public readonly keycloakRepo: ecr.Repository;
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.repo = new ecr.Repository(this, 'BackendRepo', {
      repositoryName: BACKEND_ECR_REPO,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
      removalPolicy: RemovalPolicy.RETAIN,
      emptyOnDelete: false,
    });

    // Hosted per-tenant Webex connector image (Phase E, see webex-connector/).
    this.webexConnectorRepo = new ecr.Repository(this, 'WebexConnectorRepo', {
      repositoryName: WEBEX_CONNECTOR_ECR_REPO,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
      removalPolicy: RemovalPolicy.RETAIN,
      emptyOnDelete: false,
    });

    this.keycloakRepo = new ecr.Repository(this, 'KeycloakRepo', {
      repositoryName: KEYCLOAK_ECR_REPO,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
      removalPolicy: RemovalPolicy.RETAIN,
      emptyOnDelete: false,
    });

    // One GitHub OIDC provider per account. (If the account already has one,
    // switch to OpenIdConnectProvider.fromOpenIdConnectProviderArn.)
    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    this.deployRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: `ccc-${config.stageName}-github-deploy`,
      description: `GitHub Actions deploy role for ${config.githubRepo} (${config.stageName})`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${config.githubRepo}:*`,
        },
      }),
    });

    // Assume the CDK-managed deploy/publish roles so `cdk deploy` works.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkRoles',
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    // Push backend images to ECR (build/push happens in the workflow, not CFN).
    this.repo.grantPullPush(this.deployRole);
    this.webexConnectorRepo.grantPullPush(this.deployRole);
    this.keycloakRepo.grantPullPush(this.deployRole);
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrAuthToken',
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );

    // Sync the built SPA to the web bucket and invalidate the CDN.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WebBucketSync',
        actions: ['s3:ListBucket', 's3:PutObject', 's3:DeleteObject', 's3:GetObject'],
        resources: [
          `arn:aws:s3:::${webBucketName(config)}`,
          `arn:aws:s3:::${webBucketName(config)}/*`,
        ],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFrontInvalidate',
        actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation', 'cloudfront:ListDistributions'],
        resources: ['*'],
      }),
    );

    new CfnOutput(this, 'EcrRepoUri', { value: this.repo.repositoryUri });
    new CfnOutput(this, 'DeployRoleArn', { value: this.deployRole.roleArn });
  }
}
