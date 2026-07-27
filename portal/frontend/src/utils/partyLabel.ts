/** Format a call party as `(Description) Extension` when both are known. */

function localPart(addr: string): string {
  return addr.includes('@') ? addr.split('@')[0] : addr;
}

/** Prefer a phone/extension id; fall back to SIP/email local part. */
export function partyExtension(addr?: string | null): string | null {
  if (!addr) return null;
  const local = localPart(addr).trim();
  if (!local) return null;
  const digits = local.replace(/\D/g, '');
  if (digits.length >= 3) {
    // Keep short extensions as-is; for longer DIDs prefer the raw local form
    // when it still looks numeric-ish (+E.164 etc.).
    if (digits.length <= 7) return digits;
    return local.startsWith('+') ? local : digits;
  }
  return local;
}

function stripWrappedParens(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')') && trimmed.indexOf(')') === trimmed.length - 1) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** If UDS already stored `(Name) 1001`, reuse it as-is. */
function alreadyFormatted(name: string): boolean {
  return /^\(.+\)\s+\S+$/.test(name.trim());
}

function normalizeComparable(value: string): string {
  return value.replace(/\D/g, '').toLowerCase() || value.trim().toLowerCase();
}

/**
 * Display label for near/far parties.
 * Examples: `(Lamp, Michael) 4000`, `(Jeff Metcalf) jmetcalf`, `6026352608`
 */
export function formatParty(name?: string | null, addr?: string | null): string {
  const rawName = (name || '').trim();
  if (rawName && alreadyFormatted(rawName)) return rawName;

  const ext = partyExtension(addr);
  const label = rawName ? stripWrappedParens(rawName) : '';

  if (label && ext) {
    if (normalizeComparable(label) === normalizeComparable(ext)) return ext;
    return `(${label}) ${ext}`;
  }
  if (label) return label;
  return ext || addr || 'Unknown';
}
