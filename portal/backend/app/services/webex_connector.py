"""Per-tenant isolated hosted Webex connector: launch/teardown orchestration.

Every tenant gets its own ECS service, own SSM-stored secrets, and own ALB
routing target — deliberately not a shared multi-tenant process, so one
tenant's credentials/connections/failures can never touch another's. All
tenants share a single ECS task *definition* (registered once via CDK); only
the running service/task, its secrets, and its ALB target are per-tenant.

The actual Webex recording-retrieval mechanism the connector container uses
is unvalidated pending a live-org spike (see docs/webex-service-app.md) — this
module only handles standing the isolated infrastructure up and down.
"""

import logging
import secrets as _secrets

import boto3
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import ConnectorCredential, WebexConnectorInstance

logger = logging.getLogger(__name__)


def connector_provisioning_enabled() -> bool:
    return bool(
        settings.webex_connector_cluster_arn
        and settings.webex_connector_task_definition_arn
        and settings.webex_connector_subnet_id_list
    )


def _ecs():
    return boto3.client("ecs", region_name=settings.webex_connector_region or None)


def _elbv2():
    return boto3.client("elbv2", region_name=settings.webex_connector_region or None)


def _ssm():
    return boto3.client("ssm", region_name=settings.webex_connector_region or None)


def _ssm_prefix(tenant_id: int) -> str:
    return f"{settings.webex_connector_ssm_prefix}/{tenant_id}"


def _service_name(tenant_id: int) -> str:
    return f"webex-connector-t{tenant_id}"


async def get_instance(db: AsyncSession, tenant_id: int) -> WebexConnectorInstance | None:
    return (
        await db.execute(
            select(WebexConnectorInstance).where(WebexConnectorInstance.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()


def _next_rule_priority(elb, listener_arn: str) -> int:
    rules = elb.describe_rules(ListenerArn=listener_arn)["Rules"]
    used = {int(r["Priority"]) for r in rules if r["Priority"] != "default"}
    priority = 1
    while priority in used:
        priority += 1
    return priority


async def launch_tenant_connector(
    db: AsyncSession, tenant_id: int, connector_credential: ConnectorCredential, connector_token: str
) -> WebexConnectorInstance:
    """Idempotently stand up this tenant's isolated connector instance."""
    if not connector_provisioning_enabled():
        raise RuntimeError("Hosted Webex connector infra is not configured")

    existing = await get_instance(db, tenant_id)
    if existing is not None and existing.status in ("provisioning", "running"):
        return existing

    ssm_prefix = _ssm_prefix(tenant_id)
    webhook_secret = _secrets.token_urlsafe(24)

    ssm = _ssm()
    for name, value in (
        ("webhook_secret", webhook_secret),
        ("connector_token", connector_token),
    ):
        ssm.put_parameter(
            Name=f"{ssm_prefix}/{name}",
            Value=value,
            Type="SecureString",
            Overwrite=True,
        )

    elb = _elbv2()
    # One target group per tenant (Fargate awsvpc mode -> target type "ip").
    tg = elb.create_target_group(
        Name=f"wxc-t{tenant_id}"[:32],
        Protocol="HTTP",
        Port=8080,
        VpcId=_vpc_id_from_listener(elb),
        TargetType="ip",
        HealthCheckPath="/healthz",
    )["TargetGroups"][0]
    target_group_arn = tg["TargetGroupArn"]

    listener_rule_arn = None
    if settings.webex_connector_listener_arn:
        priority = _next_rule_priority(elb, settings.webex_connector_listener_arn)
        rule = elb.create_rule(
            ListenerArn=settings.webex_connector_listener_arn,
            Priority=priority,
            Conditions=[{"Field": "path-pattern", "Values": [f"/t/{tenant_id}/webhook"]}],
            Actions=[{"Type": "forward", "TargetGroupArn": target_group_arn}],
        )["Rules"][0]
        listener_rule_arn = rule["RuleArn"]

    # ECS services (unlike one-off RunTask calls) don't support per-service
    # container environment overrides, so every tenant's task runs the exact
    # same shared task definition. Each container instead self-discovers its
    # tenant_id at startup: it reads its own task ARN off the ECS Task
    # Metadata endpoint, calls ecs:DescribeTasks, and reads the "tenant_id"
    # tag propagated from the service (propagateTags="SERVICE" below) — then
    # derives its own SSM prefix (settings.webex_connector_ssm_prefix/{tenant_id})
    # and fetches its secrets directly. No per-tenant task definitions.
    ecs = _ecs()
    service = ecs.create_service(
        cluster=settings.webex_connector_cluster_arn,
        serviceName=_service_name(tenant_id),
        taskDefinition=settings.webex_connector_task_definition_arn,
        desiredCount=1,
        launchType="FARGATE",
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": settings.webex_connector_subnet_id_list,
                "securityGroups": settings.webex_connector_security_group_id_list,
                # Dev has no NAT gateway; connector tasks run in public
                # subnets and need outbound access to Webex, ECR, and SSM.
                "assignPublicIp": "ENABLED",
            }
        },
        loadBalancers=[
            {
                "targetGroupArn": target_group_arn,
                "containerName": settings.webex_connector_container_name,
                "containerPort": 8080,
            }
        ],
        tags=[{"key": "tenant_id", "value": str(tenant_id)}],
        propagateTags="SERVICE",
    )
    ecs_service_arn = service["service"]["serviceArn"]

    webhook_url = None
    if settings.webex_connector_domain:
        webhook_url = f"https://{settings.webex_connector_domain}/t/{tenant_id}/webhook"

    if existing is None:
        instance = WebexConnectorInstance(
            tenant_id=tenant_id,
            connector_credential_id=connector_credential.id,
            ecs_service_arn=ecs_service_arn,
            alb_target_group_arn=target_group_arn,
            alb_listener_rule_arn=listener_rule_arn,
            ssm_prefix=ssm_prefix,
            webhook_url=webhook_url,
            status="provisioning",
        )
        db.add(instance)
    else:
        instance = existing
        instance.connector_credential_id = connector_credential.id
        instance.ecs_service_arn = ecs_service_arn
        instance.alb_target_group_arn = target_group_arn
        instance.alb_listener_rule_arn = listener_rule_arn
        instance.ssm_prefix = ssm_prefix
        instance.webhook_url = webhook_url
        instance.status = "provisioning"
        instance.error = None
    await db.flush()
    return instance


def _vpc_id_from_listener(elb) -> str:
    """Derive the VPC from the shared listener's load balancer (avoids a
    separate VpcId setting that could drift from the real network config)."""
    listener = elb.describe_listeners(ListenerArns=[settings.webex_connector_listener_arn])[
        "Listeners"
    ][0]
    lb = elb.describe_load_balancers(LoadBalancerArns=[listener["LoadBalancerArn"]])[
        "LoadBalancers"
    ][0]
    return lb["VpcId"]


async def refresh_tenant_connector_status(db: AsyncSession, tenant_id: int) -> WebexConnectorInstance | None:
    """Poll ECS for the tenant's service and update status (running/error)."""
    instance = await get_instance(db, tenant_id)
    if instance is None or not instance.ecs_service_arn:
        return instance
    ecs = _ecs()
    resp = ecs.describe_services(
        cluster=settings.webex_connector_cluster_arn, services=[instance.ecs_service_arn]
    )
    services = resp.get("services", [])
    if not services:
        instance.status = "error"
        instance.error = "ECS service not found"
        return instance
    svc = services[0]
    if svc.get("runningCount", 0) >= 1:
        instance.status = "running"
        instance.error = None
    elif svc.get("status") == "ACTIVE":
        instance.status = "provisioning"
    else:
        instance.status = "error"
        instance.error = svc.get("status")
    return instance


async def teardown_tenant_connector(db: AsyncSession, tenant_id: int) -> None:
    """Tear down this tenant's connector instance and all its AWS resources."""
    instance = await get_instance(db, tenant_id)
    if instance is None:
        return

    ecs = _ecs()
    elb = _elbv2()
    ssm = _ssm()

    if instance.ecs_service_arn:
        try:
            ecs.update_service(
                cluster=settings.webex_connector_cluster_arn,
                service=instance.ecs_service_arn,
                desiredCount=0,
            )
            ecs.delete_service(
                cluster=settings.webex_connector_cluster_arn,
                service=instance.ecs_service_arn,
                force=True,
            )
        except Exception:
            logger.exception("Failed to delete ECS service for tenant %s", tenant_id)

    if instance.alb_listener_rule_arn:
        try:
            elb.delete_rule(RuleArn=instance.alb_listener_rule_arn)
        except Exception:
            logger.exception("Failed to delete ALB listener rule for tenant %s", tenant_id)

    if instance.alb_target_group_arn:
        try:
            elb.delete_target_group(TargetGroupArn=instance.alb_target_group_arn)
        except Exception:
            logger.exception("Failed to delete ALB target group for tenant %s", tenant_id)

    for name in ("webhook_secret", "connector_token"):
        try:
            ssm.delete_parameter(Name=f"{instance.ssm_prefix}/{name}")
        except ssm.exceptions.ParameterNotFound:
            pass
        except Exception:
            logger.exception("Failed to delete SSM param %s for tenant %s", name, tenant_id)

    await db.delete(instance)
