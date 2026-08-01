import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Group, List, Stack, Text, Title } from '@mantine/core';
import { api } from '../../api/client';

export function WebexSetupTab() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['webex-status'], queryFn: api.webex.status });
  const connector = useQuery({ queryKey: ['webex-connector-status'], queryFn: api.webex.connectorStatus });
  const s = status.data;
  const c = connector.data;

  const configured = s?.serviceapp_configured ?? false;
  const authorized = s?.authorized ?? false;
  const provisioningAvailable = c?.enabled === true;
  const connectorStatus = c?.status;
  const canEnable =
    provisioningAvailable && configured && authorized && connectorStatus !== 'running' && connectorStatus !== 'provisioning';
  const canDisable =
    provisioningAvailable && !!connectorStatus && connectorStatus !== 'not_provisioned';

  const enable = useMutation({
    mutationFn: api.webex.enableConnector,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webex-connector-status'] });
      qc.invalidateQueries({ queryKey: ['tenant-connectors'] });
    },
  });
  const disable = useMutation({
    mutationFn: api.webex.disableConnector,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webex-connector-status'] });
      qc.invalidateQueries({ queryKey: ['tenant-connectors'] });
    },
  });

  return (
    <Stack gap="md">
      <Title order={3}>WXC setup</Title>
      <Text size="sm" c="dimmed">
        Authorize the Service App in Control Hub, then enable the WXC connector here. The portal
        writes Webex tokens and connector configuration, then starts a dedicated Docker poller for
        your org — no manual CLI deploy required.
      </Text>

      <Card padding="md" radius="md" withBorder>
        <Text size="sm" fw={600} mb="xs">
          Customer steps
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            In Control Hub → Management → Apps → Service Apps, authorize{' '}
            <strong>CCC Recording Portal</strong>
          </List.Item>
          <List.Item>Confirm authorization status below shows <strong>Authorized</strong></List.Item>
          <List.Item>Optional: Settings → Group sync for Control Hub group → portal role mapping</List.Item>
          <List.Item>Optional: Settings → Recorded users for licensed owner emails</List.Item>
          {configured && authorized && provisioningAvailable ? (
            <List.Item>Click <strong>Enable WXC connector</strong> below to start recording ingest</List.Item>
          ) : (
            <List.Item>
              After platform setup and Control Hub authorization, enable the WXC connector from this page
            </List.Item>
          )}
        </List>
      </Card>

      {!configured ? (
        <Alert color="yellow" variant="light" title="Service App not configured on this deployment">
          Platform credentials are missing. Contact CloudCoreCollab support to complete Webex Service App
          setup for this portal.
        </Alert>
      ) : authorized ? (
        <Card padding="lg" radius="md">
          <Group justify="space-between">
            <div>
              <Text size="sm" fw={500}>
                Authorization status
              </Text>
              <Text size="sm" c="green">
                Authorized
              </Text>
            </div>
            {s?.org_name && (
              <div>
                <Text size="sm" fw={500}>
                  Webex org
                </Text>
                <Text size="sm" c="dimmed">
                  {s.org_name}
                </Text>
              </div>
            )}
          </Group>
        </Card>
      ) : (
        <Alert color="blue" variant="light" title="Waiting for Control Hub authorization">
          A Full Administrator must authorize the Service App before the WXC connector can be enabled.
        </Alert>
      )}

      <Card padding="lg" radius="md" withBorder>
        <Group justify="space-between" align="flex-start">
          <div>
            <Text size="sm" fw={500}>
              WXC recording connector
            </Text>
            <Text size="sm" c="dimmed" maw={520}>
              Polls Webex Calling recordings (MP3 + VTT) and ingests them into this portal. One
              container per tenant, managed automatically from here.
            </Text>
            {connectorStatus && connectorStatus !== 'not_provisioned' && (
              <Badge
                mt="xs"
                color={
                  connectorStatus === 'running'
                    ? 'green'
                    : connectorStatus === 'error'
                      ? 'red'
                      : 'yellow'
                }
              >
                {connectorStatus}
              </Badge>
            )}
            {c?.container && (
              <Text size="xs" c="dimmed" mt="xs" ff="monospace">
                {c.container}
              </Text>
            )}
            {c?.error && (
              <Text size="xs" c="red" mt="xs">
                {c.error}
              </Text>
            )}
            {!provisioningAvailable && (
              <Text size="xs" c="dimmed" mt="xs">
                {c?.detail ?? 'Connector provisioning is not enabled on this deployment.'}
              </Text>
            )}
          </div>
          {!provisioningAvailable ? null : canDisable ? (
            <Button color="red" variant="light" loading={disable.isPending} onClick={() => disable.mutate()}>
              Disable
            </Button>
          ) : canEnable ? (
            <Button loading={enable.isPending} onClick={() => enable.mutate()}>
              Enable WXC connector
            </Button>
          ) : null}
        </Group>
        {provisioningAvailable && (!configured || !authorized) && (
          <Text size="xs" c="dimmed" mt="sm">
            Authorize the Service App above before enabling the connector.
          </Text>
        )}
      </Card>
    </Stack>
  );
}
