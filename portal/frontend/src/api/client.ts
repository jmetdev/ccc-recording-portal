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
  status: string;
  sentiment: string | null;
  group_id: number | null;
};

export type Recording = {
  id: number;
  call_id: number;
  leg: string;
  path_m4a: string | null;
  has_peaks: boolean;
};

export type DashboardStats = {
  calls_today: number;
  calls_total: number;
  recording_now: number;
  extensions_enabled: number;
};

function authHeaders(): HeadersInit {
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
  me: () => request<User>('/auth/me'),
  dashboardStats: () => request<DashboardStats>('/dashboard/stats'),
  currentlyRecording: () => request<Call[]>('/calls/live'),
  listCalls: (params: Record<string, string>) => {
    const q = new URLSearchParams(params).toString();
    return request<{ items: Call[]; total: number }>(`/calls?${q}`);
  },
  getCall: (id: number) => request<Call>(`/calls/${id}`),
  listRecordings: (callId: number) => request<Recording[]>(`/calls/${callId}/recordings`),
  getRecordings: (callId: number) => request<Recording[]>(`/calls/${callId}/recordings`),
  getPeaks: (recordingId: number) => request<{ recording_id: number; peaks: unknown }>(`/recordings/${recordingId}/peaks`),
  audioUrl: (recordingId: number) => `${API_BASE}/recordings/${recordingId}/audio`,
  listTags: (callId: number) => request<Tag[]>(`/calls/${callId}/tags`),
  getTags: (callId: number) => request<Tag[]>(`/calls/${callId}/tags`),
  createTag: (body: Omit<Tag, 'id' | 'created_at' | 'created_by'>) =>
    request<Tag>('/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  searchTranscripts: (q: string, sentiment?: string) => {
    const params = new URLSearchParams({ q });
    if (sentiment) params.set('sentiment', sentiment);
    return request<TranscriptSearchResult[]>(`/transcripts/search?${params}`);
  },
  admin: {
    users: () => request<User[]>('/admin/users'),
    createUser: (body: unknown) =>
      request<User>('/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    groups: () => request<Group[]>('/admin/groups'),
    createGroup: (name: string) =>
      request<Group>('/admin/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),
    roles: () => request<Role[]>('/admin/roles'),
    createRole: (body: unknown) =>
      request<Role>('/admin/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    extensions: () => request<Extension[]>('/admin/extensions'),
    createExtension: (body: unknown) =>
      request<Extension>('/admin/extensions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  },
};

export type Tag = {
  id: number;
  call_id: number;
  channel: string;
  start_s: number;
  end_s: number;
  note: string | null;
  created_at: string;
  created_by: number | null;
};

export type Group = { id: number; name: string };
export type Role = { id: number; name: string; description: string | null; permissions: string[] };
export type Extension = { id: number; extension: string; label: string | null; enabled: boolean; group_id: number | null };

export type TranscriptSearchResult = {
  transcript_id: number;
  call_id: number;
  leg: string;
  headline: string;
  sentiment: string | null;
  rank: number;
};

export function hasPermission(user: User | null, permission: string): boolean {
  return user?.permissions.includes(permission) ?? false;
}
