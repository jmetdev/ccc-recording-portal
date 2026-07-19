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
import { suiteApi, SuiteApp, SuiteTenant, SuiteTenantStatus } from '../../suite/api';

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

function emptyEntitlements(): EntitlementForm {
  return { recording: false, fax: false, spam: false };
}

function entitlementsFromTenant(tenant: SuiteTenant): EntitlementForm {
  const form = emptyEntitlements();
  for (const e of tenant.entitlements) form[e.app] = e.licensed;
  return form;
}

export function AdminTenantsPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const {
    data: me,
    isLoading: meLoading,
    error: meError,
  } = useQuery({ queryKey: ['suite-me'], queryFn: suiteApi.me, retry: false });

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
  const [error, setError] = useState('');

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [entitlements, setEntitlements] = useState<EntitlementForm>(emptyEntitlements());

  const resetCreateForm = () => {
    setSlug('');
    setName('');
    setAdminEmail('');
    setEntitlements(emptyEntitlements());
    setError('');
  };

  const createMutation = useMutation({
    mutationFn: () =>
      suiteApi.platform.createTenant({
        slug,
        name,
        admin_email: adminEmail,
        entitlements: APPS.map((a) => ({ app: a.id, licensed: entitlements[a.id] })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suite-tenants'] });
      setCreateOpen(false);
      resetCreateForm();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not create tenant'),
  });

  const updateEntitlementsMutation = useMutation({
    mutationFn: (vars: { id: number; entitlements: EntitlementForm }) =>
      suiteApi.platform.updateTenant(vars.id, {
        entitlements: APPS.map((a) => ({ app: a.id, licensed: vars.entitlements[a.id] })),
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
              <Table.Td>{t.webex_org_id ?? '—'}</Table.Td>
              <Table.Td>
                {t.entitlements
                  .filter((e) => e.licensed)
                  .map((e) => APPS.find((a) => a.id === e.app)?.label ?? e.app)
                  .join(', ') || '—'}
              </Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end">
                  <Button
                    size="compact-sm"
                    variant="default"
                    onClick={() => {
                      setEditTenant(t);
                      setEntitlements(entitlementsFromTenant(t));
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
              <Table.Td colSpan={6}>
                <Text c="red" ta="center" py="md">
                  {tenantsError instanceof Error ? tenantsError.message : 'Could not load tenants.'}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
          {!tenantsLoading && !tenantsError && (tenants ?? []).length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={6}>
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
            description="The customer's initial admin — their first Webex sign-in links this tenant"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.currentTarget.value)}
            required
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
                  onChange={(e) => setEntitlements((prev) => ({ ...prev, [a.id]: e.currentTarget.checked }))}
                />
              ))}
            </Stack>
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

      <Modal opened={!!editTenant} onClose={() => setEditTenant(null)} title={`Edit licenses — ${editTenant?.name ?? ''}`}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <Stack gap={6}>
            {APPS.map((a) => (
              <Checkbox
                key={a.id}
                label={a.label}
                checked={entitlements[a.id]}
                onChange={(e) => setEntitlements((prev) => ({ ...prev, [a.id]: e.currentTarget.checked }))}
              />
            ))}
          </Stack>
          <Button
            fullWidth
            loading={updateEntitlementsMutation.isPending}
            onClick={() => editTenant && updateEntitlementsMutation.mutate({ id: editTenant.id, entitlements })}
          >
            Save
          </Button>
        </Stack>
      </Modal>
    </Container>
  );
}
