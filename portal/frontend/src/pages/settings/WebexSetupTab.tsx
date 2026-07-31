import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Group, List, Stack, Text, Title } from '@mantine/core';
import { api } from '../../api/client';

export function WebexSetupTab() {
  const status = useQuery({ queryKey: ['webex-status'], queryFn: api.webex.status });
  const s = status.data;

  const configured = s?.serviceapp_configured ?? false;
  const authorized = s?.authorized ?? false;

  return (
    <Stack gap="md">
      <Title order={3}>WXC setup</Title>
      <Text size="sm" c="dimmed">
        Webex Calling (WXC) tenants authorize the CCC Recording Portal Service App once in Control
        Hub. That unlocks org-admin detection and Control Hub group sync. Recording ingest runs via
        the external WXC connector (Docker on the VPS) — not the on-prem UCM edge stack.
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
            Settings → Group sync to map Control Hub groups to portal roles and call-visibility groups
          </List.Item>
          <List.Item>
            Settings → Connectors → create a <strong>webex</strong> credential, then deploy{' '}
            <Text span ff="monospace" fz="xs">
              ccc-connector-webex
            </Text>{' '}
            on the VPS with that token
          </List.Item>
          <List.Item>
            Settings → Recorded users — add Webex owner emails that should count against recording
            seats (parallel to UCM extensions)
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
              : 'A Full Administrator must authorize CCC Recording Portal in Control Hub before group sync or WXC recording ingest can work.'}
        </Alert>
      )}

      <Card padding="lg" radius="md" withBorder>
        <Text size="sm" fw={600} mb="xs">
          WXC connector (recording ingest)
        </Text>
        <Text size="sm" c="dimmed">
          Deploy one Docker Compose instance of{' '}
          <Text span ff="monospace" fz="xs">
            ccc-connector-webex
          </Text>{' '}
          per customer org on the VPS. It polls Webex for converged Calling recordings (MP3 +
          VTT) and pushes them to this portal over ingest v2. Create the connector token under
          Settings → Connectors (kind <strong>webex</strong>).
        </Text>
        <Text size="xs" c="dimmed" mt="sm">
          Webex delivers muxed mono audio — unlike UCM dual-channel recordings. Transcripts come from
          Webex VTT (no on-prem Whisper).
        </Text>
      </Card>
    </Stack>
  );
}
