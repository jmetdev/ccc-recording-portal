"""Self-discovering config for a per-tenant hosted Webex connector instance.

Env-first (VPS / docker backend): TENANT_ID + WEBHOOK_SECRET + CONNECTOR_TOKEN
are set directly on the container — no boto3 at import time.

ECS fallback: discover tenant_id from task tags and load secrets from SSM.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request

logger = logging.getLogger("webex_connector.config")

METADATA_URI = os.environ.get("ECS_CONTAINER_METADATA_URI_V4", "")
AWS_REGION = os.environ.get("AWS_REGION", "")
SSM_PREFIX = os.environ.get("SSM_PREFIX", "/ccc/dev/webex-connector")
PORTAL_URL = os.environ.get("PORTAL_URL", "https://recorddev.cloudcorecollab.com").rstrip("/")


def _env_config() -> dict[str, str] | None:
    tenant_id = os.environ.get("TENANT_ID")
    webhook_secret = os.environ.get("WEBHOOK_SECRET")
    connector_token = os.environ.get("CONNECTOR_TOKEN")
    if tenant_id and webhook_secret and connector_token:
        return {
            "tenant_id": tenant_id,
            "webhook_secret": webhook_secret,
            "connector_token": connector_token,
            "portal_url": PORTAL_URL,
        }
    return None


def _task_arn() -> str:
    with urllib.request.urlopen(f"{METADATA_URI}/task", timeout=5) as resp:
        return json.load(resp)["TaskARN"]


def _cluster_arn_from_task(task_arn: str) -> str:
    return task_arn.split(":task/", 1)[1].split("/", 1)[0]


def discover_tenant_id() -> str:
    if not METADATA_URI:
        tid = os.environ.get("DEV_TENANT_ID") or os.environ.get("TENANT_ID")
        if tid:
            return tid
        raise RuntimeError("No ECS_CONTAINER_METADATA_URI_V4 and no TENANT_ID set")
    import boto3

    task_arn = _task_arn()
    cluster = _cluster_arn_from_task(task_arn)
    ecs = boto3.client("ecs", region_name=AWS_REGION or None)
    tags = ecs.list_tags_for_resource(resourceArn=task_arn).get("tags", [])
    for tag in tags:
        if tag.get("key") == "tenant_id":
            return tag["value"]
    raise RuntimeError(f"No tenant_id tag found on task {task_arn} (cluster {cluster})")


def _ecs_config() -> dict[str, str]:
    import boto3

    tenant_id = discover_tenant_id()
    ssm_prefix = f"{SSM_PREFIX}/{tenant_id}"
    ssm = boto3.client("ssm", region_name=AWS_REGION or None)

    def _get(name: str) -> str:
        return ssm.get_parameter(Name=f"{ssm_prefix}/{name}", WithDecryption=True)["Parameter"]["Value"]

    return {
        "tenant_id": tenant_id,
        "webhook_secret": _get("webhook_secret"),
        "connector_token": _get("connector_token"),
        "portal_url": PORTAL_URL,
    }


def load_config() -> dict[str, str]:
    env = _env_config()
    if env is not None:
        return env
    return _ecs_config()


class Config:
    def __init__(self) -> None:
        data = load_config()
        self.tenant_id = data["tenant_id"]
        self.webhook_secret = data["webhook_secret"]
        self.connector_token = data["connector_token"]
        self.portal_url = data["portal_url"]


config = Config()
