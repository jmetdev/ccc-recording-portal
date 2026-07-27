import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Container,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useAuth } from '../../auth/AuthContext';
import { CloudCoreLogo } from '../../components/CloudCoreLogo';
import { suiteApi, SuiteApp, SuiteTenant, SuiteTenantStatus, EntitlementInput } from '../../suite/api';

const APPS: { id: SuiteApp; label: string }[] = [
  { id: 'recording', label: 'Cloud Core Record' },
  { id: 'fax', label: 'Cloud Core Fax' },
  { id: 'spam', label: 'Cloud Core Spam & Scam' },
];

const STATUS_COLOR: Record<SuiteTenantStatus, string> = {
  pending: 'yellow',
  active: 'green',
  suspended: 'red',
};

type EntitlementForm = Record<SuiteApp, boolean>;
type SeatsForm = Partial<Record<SuiteApp, number | ''>>;

function emptyEntitlements(): EntitlementForm {
  return { recording: false, fax: false, spam: false };
}

function entitlementsFromTenant(tenant: SuiteTenant): EntitlementForm {
  const form = emptyEntitlements();
  for (const e of tenant.entitlements) form[e.app] = e.licensed;
  return form;
}

function seatsFromTenant(tenant: SuiteTenant): SeatsForm {
  const seats: SeatsForm = {};
  for (const e of tenant.entitlements) {
    if (e.app === 'recording' && e.limits_json?.recording_seats != null) {
      seats.recording = Number(e.limits_json.recording_seats);
    }
  }
  return seats;
}

function domainsToInput(domains: string[]): string {
  return domains.join(', ');
}

function parseDomainsInput(raw: string): string[] {
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

function defaultDomainsFromEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

function entitlementsPayload(
  licensed: EntitlementForm,
  seats: SeatsForm,
): EntitlementInput[] {
  return APPS.map((a) => {
    const item: EntitlementInput = { app: a.id, licensed: licensed[a.id] };
    if (a.id === 'recording' && licensed.recording && seats.recording !== '' && seats.recording != null) {
      item.limits_json = { recording_seats: Number(seats.recording) };
    }
    return item;
  });
}

export function AdminTenantsPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const {
    data: me,
    isLoading: meLoading,
    error: meError,
  } = useQuery({ queryKey: ['suite-me'], queryFn: () => suiteApi.me(), retry: false });

  const {
    data: tenants,
    isLoading: tenantsLoading,
    error: tenantsError,
  } = useQuery({
    queryKey: ['suite-tenants'],
    queryFn: suiteApi.platform.listTenants,
    enabled: !!me?.is_superadmin,
    retry: false,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editTenant, setEditTenant] = useState<SuiteTenant | null>(null);
  const [editDetailsTenant, setEditDetailsTenant] = useState<SuiteTenant | null>(null);
  const [error, setError] = useState('');

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [emailDomainsInput, setEmailDomainsInput] = useState('');
  const [editAdminEmail, setEditAdminEmail] = useState('');
  const [editEmailDomainsInput, setEditEmailDomainsInput] = useState('');
  const [entitlements, setEntitlements] = useState<EntitlementForm>(emptyEntitlements());
  const [recordingSeats, setRecordingSeats] = useState<number | ''>('');

  const resetCreateForm = () => {
    setSlug('');
    setName('');
    setAdminEmail('');
    setEmailDomainsInput('');
    setEntitlements(emptyEntitlements());
    setRecordingSeats('');
    setError('');
  };

  const createEmailDomains = (): string[] | undefined => {
    const parsed = parseDomainsInput(emailDomainsInput);
    if (parsed.length > 0) return parsed;
    const fallback = defaultDomainsFromEmail(adminEmail);
    return fallback ? [fallback] : undefined;
  };

  const createMutation = useMutation({
    mutationFn: () =>
      suiteApi.platform.createTenant({
        slug,
        name,
        admin_email: adminEmail,
        email_domains: createEmailDomains(),
        entitlements: entitlementsPayload(entitlements, { recording: recordingSeats }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suite-tenants'] });
      setCreateOpen(false);
      resetCreateForm();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not create tenant'),
  });

  const updateEntitlementsMutation = useMutation({
    mutationFn: (vars: { id: number; entitlements: EntitlementForm; seats: SeatsForm }) =>
      suiteApi.platform.updateTenant(vars.id, {
        entitlements: entitlementsPayload(vars.entitlements, vars.seats),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suite-tenants'] });
      setEditTenant(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not update licenses'),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: number; status: SuiteTenantStatus }) =>
      suiteApi.platform.updateTenant(vars.id, { status: vars.status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suite-tenants'] }),
  });

  const updateDetailsMutation = useMutation({
    mutationFn: (vars: { id: number; admin_email: string; email_domains: string[] }) =>
      suiteApi.platform.updateTenant(vars.id, {
        admin_email: vars.admin_email,
        email_domains: vars.email_domains,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suite-tenants'] });
      setEditDetailsTenant(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not update tenant'),
  });

  if (meLoading) return null;

  if (meError) {
    return (
      <Container size="sm" py="xl">
        <Stack>
          <Alert color="red" title="Couldn't reach the suite service">
            {meError instanceof Error ? meError.message : 'Something went wrong talking to the suite service.'}
          </Alert>
          <Button variant="default" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </Stack>
      </Container>
    );
  }

  if (!me?.is_superadmin) {
    return (
      <Container size="sm" py="xl">
        <Alert color="red" title="Not authorized">
          {user?.email ?? 'This account'} does not have superadmin access to the suite console.
        </Alert>
      </Container>
    );
  }

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="xl">
        <CloudCoreLogo height={30} />
        <Group gap="sm">
          <Text size="sm" c="dimmed">
            {user?.email}
          </Text>
          <Button variant="default" size="compact-md" onClick={logout}>
            Sign out
          </Button>
        </Group>
      </Group>

      <Group justify="space-between" mb="md">
        <Title order={2}>Tenants</Title>
        <Button onClick={() => setCreateOpen(true)}>New tenant</Button>
      </Group>

      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Admin email</Table.Th>
            <Table.Th>Email domains</Table.Th>
            <Table.Th>Webex org</Table.Th>
            <Table.Th>Licensed</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(tenants ?? []).map((t) => (
            <Table.Tr key={t.id}>
              <Table.Td>
                <Text fw={600}>{t.name}</Text>
                <Text size="xs" c="dimmed">
                  {t.slug}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge color={STATUS_COLOR[t.status]} variant="light">
                  {t.status}
                </Badge>
              </Table.Td>
              <Table.Td>{t.admin_email}</Table.Td>
              <Table.Td>{t.email_domains?.length ? t.email_domains.join(', ') : '—'}</Table.Td>
              <Table.Td>{t.webex_org_id ?? '—'}</Table.Td>
              <Table.Td>
                {t.entitlements
                  .filter((e) => e.licensed)
                  .map((e) => {
                    const label = APPS.find((a) => a.id === e.app)?.label ?? e.app;
                    const seats =
                      e.app === 'recording' && e.limits_json?.recording_seats != null
                        ? ` (${e.limits_json.recording_seats} seats)`
                        : '';
                    return `${label}${seats}`;
                  })
                  .join(', ') || '—'}
              </Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end">
                  <Button
                    size="compact-sm"
                    variant="default"
                    onClick={() => {
                      setEditDetailsTenant(t);
                      setEditAdminEmail(t.admin_email);
                      setEditEmailDomainsInput(domainsToInput(t.email_domains ?? []));
                      setError('');
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="default"
                    onClick={() => {
                      setEditTenant(t);
                      setEntitlements(entitlementsFromTenant(t));
                      setRecordingSeats(seatsFromTenant(t).recording ?? '');
                      setError('');
                    }}
                  >
                    Edit licenses
                  </Button>
                  {t.status === 'active' ? (
                    <Button
                      size="compact-sm"
                      color="red"
                      variant="light"
                      onClick={() => statusMutation.mutate({ id: t.id, status: 'suspended' })}
                    >
                      Suspend
                    </Button>
                  ) : t.status === 'suspended' ? (
                    <Button
                      size="compact-sm"
                      color="green"
                      variant="light"
                      onClick={() => statusMutation.mutate({ id: t.id, status: 'active' })}
                    >
                      Reactivate
                    </Button>
                  ) : null}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {!tenantsLoading && tenantsError && (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Text c="red" ta="center" py="md">
                  {tenantsError instanceof Error ? tenantsError.message : 'Could not load tenants.'}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
          {!tenantsLoading && !tenantsError && (tenants ?? []).length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Text c="dimmed" ta="center" py="md">
                  No tenants yet.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Modal
        opened={createOpen}
        onClose={() => {
          setCreateOpen(false);
          resetCreateForm();
        }}
        title="New tenant"
      >
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <TextInput
            label="Slug"
            description="Lowercase, no spaces — used internally"
            value={slug}
            onChange={(e) => setSlug(e.currentTarget.value)}
            required
          />
          <TextInput
            label="Admin email"
            description="Customer's initial tenant admin — their first Webex sign-in links this org and grants them the full admin role in licensed products"
            type="email"
            value={adminEmail}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setAdminEmail(next);
              if (!emailDomainsInput.trim()) {
                const domain = defaultDomainsFromEmail(next);
                if (domain) setEmailDomainsInput(domain);
              }
            }}
            required
          />
          <TextInput
            label="Email domains"
            description="Comma-separated domains allowed to sign into this workspace once active. Defaults to the admin email domain when left empty."
            placeholder="example.com, example.org"
            value={emailDomainsInput}
            onChange={(e) => setEmailDomainsInput(e.currentTarget.value)}
          />
          <Box>
            <Text size="sm" fw={500} mb={4}>
              Licensed products
            </Text>
            <Stack gap={6}>
              {APPS.map((a) => (
                <Checkbox
                  key={a.id}
                  label={a.label}
                  checked={entitlements[a.id]}
                  onChange={(e) => {
                    // Capture before the async state updater runs — React
                    // nulls currentTarget after the handler returns.
                    const checked = e.currentTarget.checked;
                    setEntitlements((prev) => ({ ...prev, [a.id]: checked }));
                  }}
                />
              ))}
            </Stack>
            {entitlements.recording && (
              <TextInput
                label="Recording seats"
                description="Maximum enabled recorded extensions for this tenant"
                type="number"
                min={1}
                value={recordingSeats}
                onChange={(e) => {
                  const raw = e.currentTarget.value;
                  setRecordingSeats(raw === '' ? '' : Math.max(1, Number(raw)));
                }}
              />
            )}
          </Box>
          <Button
            fullWidth
            loading={createMutation.isPending}
            disabled={!name || !slug || !adminEmail}
            onClick={() => createMutation.mutate()}
          >
            Create tenant
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={!!editDetailsTenant}
        onClose={() => setEditDetailsTenant(null)}
        title={`Edit tenant — ${editDetailsTenant?.name ?? ''}`}
      >
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput
            label="Admin email"
            type="email"
            value={editAdminEmail}
            onChange={(e) => setEditAdminEmail(e.currentTarget.value)}
            required
          />
          <TextInput
            label="Email domains"
            description="Comma-separated domains allowed to sign into this workspace once active."
            value={editEmailDomainsInput}
            onChange={(e) => setEditEmailDomainsInput(e.currentTarget.value)}
          />
          <Button
            fullWidth
            loading={updateDetailsMutation.isPending}
            disabled={!editAdminEmail}
            onClick={() =>
              editDetailsTenant &&
              updateDetailsMutation.mutate({
                id: editDetailsTenant.id,
                admin_email: editAdminEmail,
                email_domains: parseDomainsInput(editEmailDomainsInput),
              })
            }
          >
            Save
          </Button>
        </Stack>
      </Modal>

      <Modal opened={!!editTenant} onClose={() => setEditTenant(null)} title={`Edit licenses — ${editTenant?.name ?? ''}`}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <Stack gap={6}>
            {APPS.map((a) => (
              <Checkbox
                key={a.id}
                label={a.label}
                checked={entitlements[a.id]}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  setEntitlements((prev) => ({ ...prev, [a.id]: checked }));
                }}
              />
            ))}
          </Stack>
          {entitlements.recording && (
            <TextInput
              label="Recording seats"
              description="Maximum enabled recorded extensions for this tenant"
              type="number"
              min={1}
              value={recordingSeats}
              onChange={(e) => {
                const raw = e.currentTarget.value;
                setRecordingSeats(raw === '' ? '' : Math.max(1, Number(raw)));
              }}
            />
          )}
          <Button
            fullWidth
            loading={updateEntitlementsMutation.isPending}
            onClick={() =>
              editTenant &&
              updateEntitlementsMutation.mutate({
                id: editTenant.id,
                entitlements,
                seats: { recording: recordingSeats },
              })
            }
          >
            Save
          </Button>
        </Stack>
      </Modal>
    </Container>
  );
}
