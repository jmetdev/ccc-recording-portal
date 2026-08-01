import { formatParty, partyExtension } from '../../utils/partyLabel';

export const TRASH_RETENTION_DAYS = 30;

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'green',
  negative: 'red',
  neutral: 'gray',
};

export function formatSentimentLabel(sentiment: string): string {
  if (!sentiment) return sentiment;
  return sentiment.charAt(0).toUpperCase() + sentiment.slice(1).toLowerCase();
}

export function daysUntilTrashPurge(trashedAt: string): number {
  const purgeAt = new Date(trashedAt).getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

/** Short m:ss for transport / tag chips. */
export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** HH:MM:SS for meta strip duration (Option B). */
export function formatDurationHms(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function shortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function longDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatCallSource(source?: string | null): string {
  if (!source) return '—';
  if (source === 'cucm') return 'CUCM';
  if (source === 'webex') return 'Webex';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export function callTitle(call: {
  subject?: string | null;
  far_name?: string | null;
  far_addr?: string | null;
}) {
  if (call.subject?.trim()) return call.subject.trim();
  return formatParty(call.far_name, call.far_addr);
}

/** Split display name vs number/extension for Option B party columns. */
export function partyParts(name?: string | null, addr?: string | null): { name: string; detail: string } {
  const rawName = (name || '').trim();
  const ext = partyExtension(addr);
  const cleaned = rawName.replace(/^\((.+)\)\s+\S+$/, '$1').trim() || rawName;
  if (cleaned && ext && cleaned.replace(/\D/g, '') !== ext.replace(/\D/g, '')) {
    return { name: cleaned.replace(/^\(|\)$/g, ''), detail: ext };
  }
  if (cleaned) return { name: cleaned.replace(/^\(|\)$/g, ''), detail: ext || '' };
  return { name: ext || addr || 'Unknown', detail: '' };
}
