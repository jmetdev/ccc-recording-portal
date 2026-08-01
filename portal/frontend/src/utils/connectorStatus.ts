import type { ConnectorHealth } from '../api/client';

export function connectorStatusLabel(status: ConnectorHealth['status']): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'stale':
      return 'Stale';
    case 'unseen':
      return 'Never connected';
    case 'disabled':
      return 'Disabled';
    default:
      return status;
  }
}

export function connectorStatusColor(status: ConnectorHealth['status']): string {
  switch (status) {
    case 'healthy':
      return 'teal';
    case 'stale':
      return 'orange';
    default:
      return 'gray';
  }
}

export function formatConnectorStats(stats: Record<string, unknown> | null | undefined): string {
  if (!stats || Object.keys(stats).length === 0) return '—';

  const parts: string[] = [];

  if (typeof stats.queue_depth === 'number') {
    parts.push(`queue: ${stats.queue_depth}`);
  }

  const sip = stats.sip_switch;
  if (sip && typeof sip === 'object' && !Array.isArray(sip)) {
    const ok = (sip as Record<string, unknown>).ok;
    const detail = (sip as Record<string, unknown>).detail;
    if (typeof ok === 'boolean') {
      parts.push(`sip: ${ok ? 'ok' : 'down'}${typeof detail === 'string' && detail ? ` (${detail})` : ''}`);
    }
  }

  const whisper = stats.whisper;
  if (whisper && typeof whisper === 'object' && !Array.isArray(whisper)) {
    const ok = (whisper as Record<string, unknown>).ok;
    const detail = (whisper as Record<string, unknown>).detail;
    if (typeof ok === 'boolean') {
      parts.push(`whisper: ${ok ? 'ok' : 'down'}${typeof detail === 'string' && detail ? ` (${detail})` : ''}`);
    }
  }

  if (Array.isArray(stats.live_channels)) {
    parts.push(`live: ${stats.live_channels.length}`);
  }

  if (parts.length > 0) return parts.join(' · ');

  return (
    Object.entries(stats)
      .filter(([, v]) => v == null || typeof v !== 'object')
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(' · ') || '—'
  );
}
