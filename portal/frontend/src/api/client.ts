const API_BASE = '/api';

export type User = {
  id: number;
  email: string;
  username: string;
  is_active: boolean;
  group_id: number | null;
  group_ids: number[];
  extension: string | null;
  roles: string[];
  permissions: string[];
};

export type Call = {
  id: number;
  refci: string;
  near_addr: string | null;
  far_addr: string | null;
  near_name: string | null;
  far_name: string | null;
  direction: string | null;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  status: 'recording' | 'processing' | 'transcribing' | 'completed' | 'failed' | string;
  status_message?: string | null;
  source: 'cucm' | 'webex' | string;
  legal_hold: boolean;
  holding: boolean;
  trashed_at: string | null;
  sentiment: string | null;
  group_id: number | null;
  group_name: string | null;
  is_unread: boolean;
};

export type Recording = {
  id: number;
  call_id: number;
  leg: string;
  path_m4a: string | null;
  media_path: string | null;
  media_mime: string | null;
  has_peaks: boolean;
};

/** Playable media exists: connector-fed rows set media_path, the legacy
 * on-host pipeline sets path_m4a after transcode. */
export function recordingHasMedia(r: Recording): boolean {
  return !!(r.media_path || r.path_m4a);
}

export type LiveChannel = {
  uuid: string;
  refci: string | null;
  near_addr: string | null;
  far_addr: string | null;
  leg: string | null;
  dest: string | null;
  direction: string | null;
  cid_num: string | null;
  cid_name: string | null;
  application: string | null;
  read_codec: string | null;
  write_codec: string | null;
  callstate: string | null;
  created_epoch: number | null;
  duration_s: number | null;
};

export type DashboardStats = {
  calls_today: number;
  calls_total: number;
  recording_now: number;
  extensions_enabled: number;
};

export type ContainerHealth = {
  name: string;
  state: 'healthy' | 'starting' | 'unhealthy' | 'down' | 'unknown';
  status: string;
  health: string | null;
  image: string | null;
  started_at: string | null;
  detail: string | null;
  source?: 'docker' | 'connector' | string;
};

export type FailedCallRow = {
  call_id: number;
  refci: string;
  near_addr: string | null;
  far_addr: string | null;
  started_at: string;
  ended_at: string | null;
  stage: string;
  message: string;
};

export type ConnectorHealth = {
  id: number;
  name: string;
  kind: 'cucm' | 'webex' | string;
  enabled: boolean;
  status: 'healthy' | 'stale' | 'unseen' | 'disabled';
  last_seen_at: string | null;
  version: string | null;
  stats: Record<string, unknown> | null;
};

export type TranscriptionCoverage = {
  mode: 'connector';
  worker_enabled: boolean;
  by_source: Record<string, { total_calls: number; transcribed_calls: number }>;
  total_calls: number;
  transcribed_calls: number;
};

export type SipSwitchHealth = {
  ok: boolean;
  fs_cli_configured: boolean;
  active_recording_channels: number;
  source?: 'fs_cli' | 'connector' | 'none' | string;
  detail?: string | null;
};

export type WhisperHealth = {
  ok: boolean | null;
  source?: 'connector' | 'none' | string;
  detail?: string | null;
  last_seen_s?: number;
};

export type SystemStatus = {
  checked_at: string;
  overall: 'healthy' | 'degraded' | 'critical';
  capability: 'full' | 'partial';
  summary: {
    containers_healthy: number;
    containers_total: number;
    recent_failures: number;
    docker_usable?: boolean;
  };
  containers: ContainerHealth[];
  connectors: ConnectorHealth[];
  services: {
    database: { ok: boolean; latency_ms?: number; error?: string };
    recordings: {
      ok: boolean;
      path?: string;
      readable?: boolean;
      writable?: boolean;
      wav_count?: number;
      ingest_log_exists?: boolean;
      error?: string;
    };
    freeswitch: SipSwitchHealth;
    transcription: TranscriptionCoverage & { whisper?: WhisperHealth };
    webex_serviceapp?: {
      ok: boolean;
      configured: boolean;
      missing_keys?: string[];
      detail?: string;
    };
  };
  recent_failures: FailedCallRow[];
  log_sources: string[];
};

export type SystemLogs = {
  source: string;
  lines: string[];
};

export function authHeaders(): HeadersInit {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let refreshPromise: Promise<boolean> | null = null;

function clearAuthAndRedirect(): void {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  window.location.href = '/login';
}

async function refreshTokens(): Promise<boolean> {
  const refresh = localStorage.getItem('refresh_token');
  if (!refresh) return false;
  const res = await fetch(`${API_BASE}/auth/refresh?token=${encodeURIComponent(refresh)}`, {
    method: 'POST',
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { access_token: string; refresh_token: string };
  localStorage.setItem('access_token', data.access_token);
  localStorage.setItem('refresh_token', data.refresh_token);
  return true;
}

async function tryRefreshTokens(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = refreshTokens().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function authFetch(url: string, init?: RequestInit, retried = false): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (res.status === 401 && !url.includes('/auth/refresh')) {
    if (!retried && (await tryRefreshTokens())) {
      return authFetch(url, init, true);
    }
    clearAuthAndRedirect();
    throw new Error('Unauthorized');
  }
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type SsoConfig = {
  enabled: boolean;
  issuer: string | null;
  client_id: string | null;
  oauth_providers?: string[];
};

export const api = {
  login: async (username: string, password: string) => {
    const body = new URLSearchParams({ username, password });
    const res = await fetch(`${API_BASE}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error('Invalid credentials');
    return res.json() as Promise<{ access_token: string; refresh_token: string }>;
  },
  ssoConfig: async () => {
    const res = await fetch(`${API_BASE}/auth/sso/config`);
    if (!res.ok) return { enabled: false, issuer: null, client_id: null, oauth_providers: [] } as SsoConfig;
    return res.json() as Promise<SsoConfig>;
  },
  ssoExchange: async (idpToken: string) => {
    const res = await fetch(`${API_BASE}/auth/sso/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: idpToken }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'SSO sign-in was rejected by the portal');
    }
    return res.json() as Promise<{ access_token: string; refresh_token: string }>;
  },
  me: () => request<User>('/auth/me'),
  dashboardStats: () => request<DashboardStats>('/dashboard/stats'),
  currentlyRecording: () => request<Call[]>('/calls/live'),
  freeswitchLiveChannels: () => request<LiveChannel[]>('/freeswitch/live-channels'),
  listCalls: (params: Record<string, string>) => {
    const q = new URLSearchParams(params).toString();
    return request<{ items: Call[]; total: number }>(`/calls?${q}`);
  },
  groupsMine: () => request<Group[]>('/groups/mine'),
  markCallRead: (callId: number) =>
    request<{ status: string }>(`/calls/${callId}/read`, { method: 'POST' }),
  markCallUnread: (callId: number) =>
    request<{ status: string }>(`/calls/${callId}/read`, { method: 'DELETE' }),
  getCall: (id: number) => request<Call>(`/calls/${id}`),
  setLegalHold: (callId: number, legal_hold: boolean) =>
    request<Call>(`/calls/${callId}/legal-hold`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legal_hold }),
    }),
  trashCall: (callId: number) =>
    request<Call>(`/calls/${callId}/trash`, { method: 'POST' }),
  restoreCall: (callId: number) =>
    request<Call>(`/calls/${callId}/restore`, { method: 'POST' }),
  listRecordings: (callId: number) => request<Recording[]>(`/calls/${callId}/recordings`),
  getRecordings: (callId: number) => request<Recording[]>(`/calls/${callId}/recordings`),
  getPeaks: (recordingId: number) => request<{ recording_id: number; peaks: unknown }>(`/recordings/${recordingId}/peaks`),
  audioUrl: (recordingId: number, opts?: { download?: boolean }) =>
    `${API_BASE}/recordings/${recordingId}/audio${opts?.download ? '?download=1' : ''}`,
  downloadRecording: async (recordingId: number, filename?: string) => {
    const res = await authFetch(api.audioUrl(recordingId, { download: true }));
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const match = cd?.match(/filename="?([^";]+)"?/i);
    const name = filename || match?.[1] || `recording-${recordingId}`;
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(obj);
  },
  downloadCallsZip: async (callIds: number[]) => {
    const res = await authFetch(`${API_BASE}/calls/download-zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_ids: callIds }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj;
    a.download = 'recordings.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(obj);
  },
  listTags: (callId: number) => request<Tag[]>(`/calls/${callId}/tags`),
  getTags: (callId: number) => request<Tag[]>(`/calls/${callId}/tags`),
  listTranscripts: (callId: number) => request<Transcript[]>(`/calls/${callId}/transcripts`),
  createTag: (body: TagCreate) =>
    request<Tag>('/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  searchTranscripts: (params: {
    q?: string;
    sentiment?: string;
    near?: string;
    far?: string;
    date_from?: string;
    date_to?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.q?.trim()) qs.set('q', params.q.trim());
    if (params.sentiment) qs.set('sentiment', params.sentiment);
    if (params.near?.trim()) qs.set('near', params.near.trim());
    if (params.far?.trim()) qs.set('far', params.far.trim());
    if (params.date_from) qs.set('date_from', params.date_from);
    if (params.date_to) qs.set('date_to', params.date_to);
    return request<TranscriptSearchResult[]>(`/transcripts/search?${qs}`);
  },
  transcriptCoverage: () => request<TranscriptionCoverage>('/transcripts/coverage'),
  systemStatus: () => request<SystemStatus>('/system/status'),
  tenant: {
    getSettings: () => request<TenantSettings>('/tenant/settings'),
    updateSettings: (body: {
      retention_days?: number | null;
      session_access_minutes?: number | null;
      session_refresh_days?: number | null;
    }) =>
      request<TenantSettings>('/tenant/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    getTranscription: () => request<TranscriptionSettings>('/tenant/transcription'),
    updateTranscription: (body: { organization_name?: string; hotwords?: string[] }) =>
      request<TranscriptionSettings>('/tenant/transcription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    connectors: () => request<ConnectorCredential[]>('/tenant/connectors'),
    createConnector: (body: { name: string; kind: string }) =>
      request<ConnectorCredentialCreated>('/tenant/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    revokeConnector: (id: number) =>
      request<{ status: string }>(`/tenant/connectors/${id}/revoke`, { method: 'POST' }),
    deleteConnector: (id: number) =>
      request<{ status: string }>(`/tenant/connectors/${id}`, { method: 'DELETE' }),
    storageStats: () => request<StorageStats>('/tenant/storage-stats'),
    licenseUsage: () => request<LicenseUsage>('/tenant/license-usage'),
  },
  webex: {
    status: () =>
      request<{
        serviceapp_configured: boolean;
        missing_keys?: string[];
        authorized: boolean;
        status: string;
        org_id: string | null;
        org_name: string | null;
        deployment?: { configured: boolean; missing_keys: string[] };
        tenant?: {
          authorized: boolean;
          status: string;
          org_id: string | null;
          org_name: string | null;
        };
      }>('/tenant/webex/status'),
    connectorStatus: () =>
      request<{ enabled: boolean; status: string | null; webhook_url: string | null }>(
        '/tenant/webex/connector/status',
      ),
    enableConnector: () =>
      request<{ status: string; webhook_url: string | null }>('/tenant/webex/connector/enable', {
        method: 'POST',
      }),
    disableConnector: () =>
      request<{ status: string }>('/tenant/webex/connector/disable', { method: 'POST' }),
    groups: () => request<{ id: string; name: string }[]>('/tenant/webex/groups'),
    groupMappings: () =>
      request<
        { id: number; webex_group_id: string; webex_group_name: string | null; role_id: number | null; group_id: number | null }[]
      >('/tenant/webex/group-mappings'),
    createGroupMapping: (body: {
      webex_group_id: string;
      webex_group_name?: string | null;
      role_id?: number | null;
      group_id?: number | null;
    }) =>
      request('/tenant/webex/group-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    deleteGroupMapping: (id: number) =>
      request<{ status: string }>(`/tenant/webex/group-mappings/${id}`, { method: 'DELETE' }),
    groupSyncState: () =>
      request<{ last_synced_at: string | null; last_sync_status: string | null; last_sync_error: string | null }>(
        '/tenant/webex/group-mappings/sync-state',
      ),
    syncGroupsNow: () =>
      request<{ changed: number | null }>('/tenant/webex/group-mappings/sync-now', { method: 'POST' }),
  },
  audit: (action?: string, pageSize = 50) => {
    const params = new URLSearchParams({ page_size: String(pageSize) });
    if (action) params.set('action', action);
    return request<AuditLog[]>(`/platform/audit?${params}`);
  },
  systemLogs: (source: string, lines = 120) =>
    request<SystemLogs>(`/system/logs/${encodeURIComponent(source)}?lines=${lines}`),
  admin: {
    users: () => request<User[]>('/admin/users'),
    createUser: (body: unknown) =>
      request<User>('/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    updateUser: (id: number, body: unknown) =>
      request<User>(`/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    deleteUser: (id: number) =>
      request<void>(`/admin/users/${id}`, { method: 'DELETE' }),
    groups: () => request<Group[]>('/admin/groups'),
    createGroup: (name: string) =>
      request<Group>('/admin/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),
    updateGroup: (id: number, name: string) =>
      request<Group>(`/admin/groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    deleteGroup: (id: number) =>
      request<{ status: string }>(`/admin/groups/${id}`, { method: 'DELETE' }),
    roles: () => request<Role[]>('/admin/roles'),
    createRole: (body: unknown) =>
      request<Role>('/admin/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    extensions: () => request<Extension[]>('/admin/recorded-extensions'),
    createExtension: (body: unknown) =>
      request<Extension>('/admin/recorded-extensions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    updateExtension: (id: number, body: unknown) =>
      request<Extension>(`/admin/recorded-extensions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    deleteExtension: (id: number) =>
      request<void>(`/admin/recorded-extensions/${id}`, { method: 'DELETE' }),
    purgeCallData: () =>
      request<{ status: string; calls_deleted: number; files_deleted: number }>('/admin/purge-call-data', {
        method: 'POST',
      }),
  },
};

export type Tag = {
  id: number;
  call_id: number;
  recording_id: number | null;
  channel: string;
  start_s: number;
  end_s: number;
  note: string | null;
  created_at: string;
  created_by: number | null;
};

export type TagCreate = {
  call_id: number;
  recording_id?: number | null;
  channel?: string;
  start_s: number;
  end_s: number;
  note?: string | null;
};

export type Group = { id: number; name: string };
export type Role = { id: number; name: string; description: string | null; permissions: string[] };
export type Extension = { id: number; extension: string; label: string | null; enabled: boolean; group_ids: number[] };

export type TranscriptSearchResult = {
  transcript_id: number;
  call_id: number;
  leg: string;
  headline: string;
  sentiment: string | null;
  rank: number;
  near_name: string | null;
  far_name: string | null;
  near_addr: string | null;
  far_addr: string | null;
  started_at: string | null;
};

export type Transcript = {
  id: number;
  call_id: number;
  leg: string;
  language: string | null;
  text: string;
  segments_json: unknown[] | null;
  sentiment: string | null;
  sentiment_score: number | null;
};

export function hasPermission(user: User | null, permission: string): boolean {
  return user?.permissions.includes(permission) ?? false;
}

// --- Tenant self-service ---

export type TenantSettings = {
  name: string;
  slug: string;
  retention_days: number | null;
  session_access_minutes: number | null;
  session_refresh_days: number | null;
};

export type TranscriptionSettings = {
  organization_name: string;
  hotwords: string[];
};

export type LicenseUsage = {
  allotted: number | null;
  used: number;
  holding_calls: number;
};

export type ConnectorCredential = {
  id: number;
  tenant_id: number;
  name: string;
  kind: 'cucm' | 'webex' | string;
  enabled: boolean;
  last_seen_at: string | null;
  version: string | null;
  created_at: string;
};

export type ConnectorCredentialCreated = ConnectorCredential & { token: string };

export type StorageStats = {
  total_bytes: number;
  recording_count: number;
  call_count: number;
  avg_bytes: number;
  by_source: { source: string; bytes: number; count: number }[];
  by_month: { month: string; bytes: number; count: number }[];
  largest: {
    recording_id: number;
    call_id: number;
    leg: string;
    bytes: number;
    started_at: string | null;
    near_name: string | null;
    far_name: string | null;
    source: string;
  }[];
  storage_backend: string | null;
};

export type AuditLog = {
  id: number;
  tenant_id: number;
  user_id: number | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};
