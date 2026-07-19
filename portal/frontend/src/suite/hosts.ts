/** Hostname roles for suite shell vs product apps. See docs/SUITE-PORTAL.md */

const SUITE_HOSTS = new Set([
  'dev.cloudcorecollab.com',
  'portal.cloudcorecollab.com',
]);

export function isSuiteHost(hostname: string = window.location.hostname): boolean {
  if (SUITE_HOSTS.has(hostname)) return true;
  if (import.meta.env.VITE_SUITE_HOST === 'true') return true;
  return false;
}

export type SuiteAppId = 'recording' | 'fax' | 'spam';

export type SuiteApp = {
  id: SuiteAppId;
  index: string;
  name: string;
  description: string;
  href?: string;
  /** Static fallback only — real entitlement state comes from the suite API
   * (see suiteApi.entitlements / SuiteHomePage) and overrides this. */
  licensed: boolean;
  meta?: string;
};

/** Product entry URLs + static marketing copy for the current environment.
 * Licensing itself is not known here — callers should merge in real
 * entitlements from suiteApi.entitlements(). */
export function suiteApps(): SuiteApp[] {
  const host = window.location.hostname;
  const isProdPortal = host === 'portal.cloudcorecollab.com';
  const recording = isProdPortal
    ? 'https://record.cloudcorecollab.com'
    : 'https://recorddev.cloudcorecollab.com';
  const fax = isProdPortal
    ? 'https://fax.cloudcorecollab.com'
    : 'https://faxdev.cloudcorecollab.com';

  return [
    {
      id: 'recording',
      index: '01',
      name: 'Cloud Core Record',
      description:
        'Search, tag, transcribe, and securely play Webex and UCM recordings—with role-based access that fits the way your teams work.',
      href: recording,
      licensed: false,
      meta: 'Open app',
    },
    {
      id: 'fax',
      index: '02',
      name: 'Cloud Core Fax',
      description:
        'Keep your existing PSTN connection and DIDs. Send and receive through Webex Calling or Zoom Phone, then deliver documents where your teams already work.',
      href: fax,
      licensed: false,
      meta: 'Open app',
    },
    {
      id: 'spam',
      index: '03',
      name: 'Cloud Core Spam & Scam',
      description:
        'Practical control over nuisance calls with local labels, routing rules, attack detection, and an optional Nomorobo layer.',
      licensed: false,
      meta: 'Coming to this environment',
    },
  ];
}
