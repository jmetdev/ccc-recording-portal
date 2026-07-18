import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Anchor, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { api } from '../../api/client';

export function WebexSetupTab() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['webex-status'], queryFn: api.webex.status });
  const connector = useQuery({ queryKey: ['webex-connector-status'], queryFn: api.webex.connectorStatus });
  const s = status.data;
  const c = connector.data;

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
        Your organization's admin authorizes the Webex Service App in Control Hub once — this
        automatically maps your Webex org to your tenant and detects org admins on login.{' '}
        <Anchor href="/docs/webex-service-app-customer.md" target="_blank">
          See the setup steps
        </Anchor>
        .
      </Text>

      {!s?.serviceapp_configured ? (
        <Alert color="yellow" variant="light">
          The Webex Service App isn't configured on this deployment yet.
        </Alert>
      ) : (
        <Card padding="lg" radius="md">
          <Group justify="space-between">
            <div>
              <Text size="sm" fw={500}>
                Authorization status
              </Text>
              <Text size="sm" c={s.authorized ? 'green' : 'dimmed'}>
                {s.authorized ? 'Authorized' : s.status === 'deauthorized' ? 'Deauthorized' : 'Not yet authorized'}
              </Text>
            </div>
            {s.org_name && (
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
      )}

      <Card padding="lg" radius="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text size="sm" fw={500}>
              Hosted Webex recording connector
            </Text>
            <Text size="sm" c="dimmed" maw={480}>
              For organizations recording calls natively through Webex Calling (no on-prem CUCM
              needed). Each tenant gets its own fully isolated connector instance — own
              connections, own credentials.
            </Text>
            {c?.status && (
              <Badge mt="xs" color={c.status === 'running' ? 'green' : c.status === 'error' ? 'red' : 'yellow'}>
                {c.status}
              </Badge>
            )}
          </div>
          {!c?.enabled ? (
            <Text size="sm" c="dimmed">
              Not available on this deployment
            </Text>
          ) : c.status ? (
            <Button color="red" variant="light" loading={disable.isPending} onClick={() => disable.mutate()}>
              Disable
            </Button>
          ) : (
            <Button loading={enable.isPending} onClick={() => enable.mutate()}>
              Enable
            </Button>
          )}
        </Group>
      </Card>
    </Stack>
  );
}
