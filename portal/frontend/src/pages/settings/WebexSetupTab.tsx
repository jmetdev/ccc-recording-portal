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
  const connectorInfra = !!c?.enabled;
  const connectorInstance = c?.status; // null = no instance yet when infra on
  const canEnableHosted = connectorInfra && configured && authorized && !connectorInstance;
  const canDisableHosted = connectorInfra && !!connectorInstance && connectorInstance !== 'not_provisioned';

  const enable = useMutation({
    mutationFn: api.webex.enableConnector,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webex-connector-status'] }),
  });
  const disable = useMutation({
    mutationFn: api.webex.disableConnector,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webex-connector-status'] }),
  });

  return (
    <Stack gap="md">
      <Title order={3}>Webex setup</Title>
      <Text size="sm" c="dimmed">
        A Control Hub Full Administrator authorizes the CCC Recording Portal Service App once. That
        unlocks org-admin detection, Control Hub group sync, and (when enabled) the hosted Webex
        Calling recording connector. CUCM on-prem recording does not require this step.
      </Text>

      <Card padding="md" radius="md" withBorder>
        <Text size="sm" fw={600} mb="xs">
          Customer steps
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            In Control Hub → Management → Apps → Service Apps, find <strong>CCC Recording Portal</strong>
          </List.Item>
          <List.Item>Review permissions and click Authorize (Full Administrator required)</List.Item>
          <List.Item>Return here — status should flip to Authorized for your Webex org</List.Item>
          <List.Item>
            Optional: Settings → Group sync to map Control Hub groups to portal roles
          </List.Item>
        </List>
      </Card>

      {!configured ? (
        <Alert color="yellow" variant="light" title="Service App not configured on this deployment">
          Platform credentials are missing. Contact CloudCoreCollab support — customers cannot
          authorize until the Service App is registered on this environment
          {s?.missing_keys?.length ? ` (missing ${s.missing_keys.join(', ')})` : ''}.
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
          {s?.status === 'deauthorized'
            ? 'Authorization was revoked in Control Hub. Re-authorize the Service App to restore org APIs.'
            : s?.status === 'error'
              ? 'Authorization was received but token exchange failed. Re-authorize or contact support.'
              : 'A Full Administrator must authorize CCC Recording Portal in Control Hub before group sync or hosted Webex recording can work.'}
        </Alert>
      )}

      <Card padding="lg" radius="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text size="sm" fw={500}>
              Hosted Webex recording connector
            </Text>
            <Text size="sm" c="dimmed" maw={480}>
              For organizations recording calls natively through Webex Calling (no on-prem CUCM
              needed). Each tenant gets its own fully isolated connector instance.
            </Text>
            {connectorInstance && connectorInstance !== 'not_provisioned' && (
              <Badge
                mt="xs"
                color={
                  connectorInstance === 'running' ? 'green' : connectorInstance === 'error' ? 'red' : 'yellow'
                }
              >
                {connectorInstance}
              </Badge>
            )}
            {connectorInfra && (!configured || !authorized) && (
              <Text size="xs" c="dimmed" mt="xs">
                Authorize the Service App above before enabling the hosted connector.
              </Text>
            )}
          </div>
          {!connectorInfra ? (
            <Text size="sm" c="dimmed">
              Not available on this deployment
            </Text>
          ) : canDisableHosted ? (
            <Button color="red" variant="light" loading={disable.isPending} onClick={() => disable.mutate()}>
              Disable
            </Button>
          ) : (
            <Button
              loading={enable.isPending}
              disabled={!canEnableHosted}
              onClick={() => enable.mutate()}
            >
              Enable
            </Button>
          )}
        </Group>
      </Card>
    </Stack>
  );
}
