const API_BASE = '/api';

export type User = {
  id: number;
  email: string;
  username: string;
  is_active: boolean;
  group_id: number | null;
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
  sentiment: string | null;
  group_id: number | null;
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

export type SystemStatus = {
  checked_at: string;
  overall: 'healthy' | 'degraded' | 'critical';
  capability: 'full' | 'partial';
  summary: {
    containers_healthy: number;
    containers_total: number;
    recent_failures: number;
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
    freeswitch: { fs_cli_configured: boolean; active_recording_channels: number };
    transcription: TranscriptionCoverage;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (res.status === 401) {
    localStorage.removeItem('access_token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type SsoConfig = {
  enabled: boolean;
  issuer: string | null;
  client_id: string | null;
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
    if (!res.ok) return { enabled: false, issuer: null, client_id: null } as SsoConfig;
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
  getCall: (id: number) => request<Call>(`/calls/${id}`),
  setLegalHold: (callId: number, legal_hold: boolean) =>
    request<Call>(`/calls/${callId}/legal-hold`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legal_hold }),
    }),
  listRecordings: (callId: number) => request<Recording[]>(`/calls/${callId}/recordings`),
  getRecordings: (callId: number) => request<Recording[]>(`/calls/${callId}/recordings`),
  getPeaks: (recordingId: number) => request<{ recording_id: number; peaks: unknown }>(`/recordings/${recordingId}/peaks`),
  audioUrl: (recordingId: number) => `${API_BASE}/recordings/${recordingId}/audio`,
  listTags: (callId: number) => request<Tag[]>(`/calls/${callId}/tags`),
  getTags: (callId: number) => request<Tag[]>(`/calls/${callId}/tags`),
  listTranscripts: (callId: number) => request<Transcript[]>(`/calls/${callId}/transcripts`),
  createTag: (body: TagCreate) =>
    request<Tag>('/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  searchTranscripts: (q: string, sentiment?: string) => {
    const params = new URLSearchParams({ q });
    if (sentiment) params.set('sentiment', sentiment);
    return request<TranscriptSearchResult[]>(`/transcripts/search?${params}`);
  },
  transcriptCoverage: () => request<TranscriptionCoverage>('/transcripts/coverage'),
  systemStatus: () => request<SystemStatus>('/system/status'),
  tenant: {
    getSettings: () => request<TenantSettings>('/tenant/settings'),
    updateSettings: (body: { retention_days: number | null }) =>
      request<TenantSettings>('/tenant/settings', {
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
      request<{ status: string }>(`/tenant/connectors/${id}`, { method: 'DELETE' }),
    storageStats: () => request<StorageStats>('/tenant/storage-stats'),
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
    deleteUser: (id: number) =>
      request<void>(`/admin/users/${id}`, { method: 'DELETE' }),
    groups: () => request<Group[]>('/admin/groups'),
    createGroup: (name: string) =>
      request<Group>('/admin/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),
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
