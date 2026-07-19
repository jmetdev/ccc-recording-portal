// Client for the suite backend (tenant provisioning / entitlements),
// same-origin at /suite-api (see portal/frontend/nginx.conf).
//
// Unlike the recording backend's api client, this uses the *raw* Keycloak ID
// token captured at SSO callback (see SsoCallbackPage) rather than a
// portal-issued JWT: the suite backend verifies Keycloak tokens directly and
// has no local user table of its own. That raw token is short-lived (Keycloak
// default access/ID token lifespan), so a suite-api call can start 401ing a
// few minutes into a session — callers should treat that as "sign in again"
// rather than a hard error.

const SUITE_API_BASE = '/suite-api';
const OIDC_TOKEN_KEY = 'oidc_id_token';

export function getOidcToken(): string | null {
  return localStorage.getItem(OIDC_TOKEN_KEY);
}

export function setOidcToken(token: string): void {
  localStorage.setItem(OIDC_TOKEN_KEY, token);
}

export function clearOidcToken(): void {
  localStorage.removeItem(OIDC_TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getOidcToken();
  const res = await fetch(`${SUITE_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = JSON.parse(text)?.detail ?? text;
    } catch {
      // not JSON; use raw text
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type SuiteApp = 'recording' | 'fax' | 'spam';

export type SuiteEntitlement = {
  app: SuiteApp;
  licensed: boolean;
  plan_name: string | null;
  limits_json: Record<string, unknown> | null;
};

export type SuiteTenantStatus = 'pending' | 'active' | 'suspended';

export type SuiteTenant = {
  id: number;
  slug: string;
  name: string;
  webex_org_id: string | null;
  status: SuiteTenantStatus;
  admin_email: string;
  linked_at: string | null;
  created_at: string;
  entitlements: SuiteEntitlement[];
};

export type MeTenant = {
  status: 'active' | 'pending_match' | 'unlinked';
  is_superadmin: boolean;
  tenant: SuiteTenant | null;
};

export type EntitlementInput = {
  app: SuiteApp;
  licensed: boolean;
  plan_name?: string | null;
  limits_json?: Record<string, unknown> | null;
};

export type TenantCreateInput = {
  slug: string;
  name: string;
  admin_email: string;
  entitlements: EntitlementInput[];
};

export type TenantUpdateInput = Partial<{
  name: string;
  admin_email: string;
  status: SuiteTenantStatus;
  entitlements: EntitlementInput[];
}>;

export const suiteApi = {
  me: () => request<MeTenant>('/me/tenant'),
  link: () => request<{ tenant: SuiteTenant }>('/me/link', { method: 'POST' }),
  entitlements: () => request<SuiteEntitlement[]>('/me/entitlements'),
  platform: {
    listTenants: () => request<SuiteTenant[]>('/platform/tenants'),
    createTenant: (body: TenantCreateInput) =>
      request<SuiteTenant>('/platform/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    updateTenant: (id: number, body: TenantUpdateInput) =>
      request<SuiteTenant>(`/platform/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  },
};
