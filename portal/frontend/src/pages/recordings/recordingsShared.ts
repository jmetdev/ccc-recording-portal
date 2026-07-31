import { formatParty } from '../../utils/partyLabel';

export const TRASH_RETENTION_DAYS = 30;

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'green',
  negative: 'red',
  neutral: 'gray',
};

export function daysUntilTrashPurge(trashedAt: string): number {
  const purgeAt = new Date(trashedAt).getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function shortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function callTitle(call: { subject?: string | null; far_name?: string | null; far_addr?: string | null }) {
  if (call.subject?.trim()) return call.subject.trim();
  return formatParty(call.far_name, call.far_addr);
}
