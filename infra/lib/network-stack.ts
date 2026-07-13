import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { StageConfig } from './config';

interface NetworkStackProps extends StackProps {
  config: StageConfig;
}

/**
 * VPC with two AZs and NO NAT gateway (the single biggest dev cost we avoid,
 * ~$32/mo). Fargate tasks live in public subnets with public IPs and reach
 * ECR / Secrets Manager / S3 straight over the internet gateway. Aurora lives
 * in isolated subnets with no internet route, reachable only from inside the VPC.
 */
export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
  }
}
