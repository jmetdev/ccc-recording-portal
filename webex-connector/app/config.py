"""Self-discovering config for a per-tenant hosted Webex connector instance.

Every tenant runs this exact image under its own ECS service; there are no
per-tenant task-definition overrides. Instead, at startup this process finds
its own tenant_id by reading the "tenant_id" tag the portal's backend set on
the ECS *service* (propagated to the task via propagateTags="SERVICE"), then
fetches its own secrets from SSM at /{ssm_prefix}/{tenant_id}/*. No other
tenant's credentials are ever loaded into this process.
"""

import json
import logging
import os
import urllib.request

import boto3

logger = logging.getLogger("webex_connector.config")

METADATA_URI = os.environ.get("ECS_CONTAINER_METADATA_URI_V4", "")
AWS_REGION = os.environ.get("AWS_REGION", "")
SSM_PREFIX = os.environ.get("SSM_PREFIX", "/ccc/dev/webex-connector")
PORTAL_URL = os.environ.get("PORTAL_URL", "https://dev.cloudcorecollab.com").rstrip("/")


def _task_arn() -> str:
    with urllib.request.urlopen(f"{METADATA_URI}/task", timeout=5) as resp:
        return json.load(resp)["TaskARN"]


def _cluster_arn_from_task(task_arn: str) -> str:
    # arn:aws:ecs:<region>:<acct>:task/<cluster>/<task-id>
    return task_arn.split(":task/", 1)[1].split("/", 1)[0]


def discover_tenant_id() -> str:
    """Read the tenant_id tag propagated from this task's ECS service."""
    if not METADATA_URI:
        # Local/dev fallback — no ECS metadata endpoint available.
        tid = os.environ.get("DEV_TENANT_ID")
        if tid:
            return tid
        raise RuntimeError("No ECS_CONTAINER_METADATA_URI_V4 and no DEV_TENANT_ID set")
    task_arn = _task_arn()
    cluster = _cluster_arn_from_task(task_arn)
    ecs = boto3.client("ecs", region_name=AWS_REGION or None)
    tags = ecs.list_tags_for_resource(resourceArn=task_arn).get("tags", [])
    for tag in tags:
        if tag.get("key") == "tenant_id":
            return tag["value"]
    raise RuntimeError(f"No tenant_id tag found on task {task_arn} (cluster {cluster})")


class Config:
    def __init__(self) -> None:
        self.tenant_id = discover_tenant_id()
        self.ssm_prefix = f"{SSM_PREFIX}/{self.tenant_id}"
        ssm = boto3.client("ssm", region_name=AWS_REGION or None)
        self.webhook_secret = self._get(ssm, "webhook_secret")
        self.connector_token = self._get(ssm, "connector_token")
        self.portal_url = PORTAL_URL

    def _get(self, ssm, name: str) -> str:
        return ssm.get_parameter(Name=f"{self.ssm_prefix}/{name}", WithDecryption=True)[
            "Parameter"
        ]["Value"]


config = Config()
