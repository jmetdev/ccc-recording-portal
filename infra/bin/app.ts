#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { STAGES } from '../lib/config';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { CiStack } from '../lib/ci-stack';
import { AppStack } from '../lib/app-stack';

const app = new cdk.App();

const stageName = (app.node.tryGetContext('stage') as string) ?? 'dev';
const config = STAGES[stageName];
if (!config) {
  throw new Error(
    `Unknown stage '${stageName}'. Known stages: ${Object.keys(STAGES).join(', ')}. ` +
      `Pass one with: cdk <cmd> -c stage=dev`,
  );
}

const env = config.env;
const prefix = `ccc-${config.stageName}`;

const network = new NetworkStack(app, `${prefix}-network`, { env, config });

const data = new DataStack(app, `${prefix}-data`, { env, config, vpc: network.vpc });
data.addDependency(network);

new CiStack(app, `${prefix}-ci`, { env, config });

const appStack = new AppStack(app, `${prefix}-app`, {
  env,
  config,
  vpc: network.vpc,
  dbCluster: data.cluster,
  mediaBucket: data.mediaBucket,
  imageTag: app.node.tryGetContext('imageTag') as string | undefined,
});
appStack.addDependency(data);
appStack.addDependency(network);

cdk.Tags.of(app).add('project', 'ccc-recording-portal');
cdk.Tags.of(app).add('stage', config.stageName);
