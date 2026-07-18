#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { STAGES } from '../lib/config';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { CiStack } from '../lib/ci-stack';
import { AppStack } from '../lib/app-stack';
import { WebexConnectorStack } from '../lib/webex-connector-stack';
import { KeycloakStack } from '../lib/keycloak-stack';

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

const webexConnector = new WebexConnectorStack(app, `${prefix}-webex-connector`, {
  env,
  config,
  vpc: network.vpc,
  imageTag: app.node.tryGetContext('webexConnectorImageTag') as string | undefined,
});
webexConnector.addDependency(network);

const keycloak = new KeycloakStack(app, `${prefix}-keycloak`, {
  env,
  config,
  vpc: network.vpc,
  dbCluster: data.cluster,
  imageTag: app.node.tryGetContext('keycloakImageTag') as string | undefined,
});
keycloak.addDependency(data);
keycloak.addDependency(network);

const appStack = new AppStack(app, `${prefix}-app`, {
  env,
  config,
  vpc: network.vpc,
  dbCluster: data.cluster,
  mediaBucket: data.mediaBucket,
  webexConnector,
  imageTag: app.node.tryGetContext('imageTag') as string | undefined,
});
appStack.addDependency(data);
appStack.addDependency(network);
appStack.addDependency(webexConnector);
appStack.addDependency(keycloak);

cdk.Tags.of(app).add('project', 'ccc-recording-portal');
cdk.Tags.of(app).add('stage', config.stageName);
