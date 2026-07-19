/** Hostname roles for suite shell vs product apps. See docs/SUITE-PORTAL.md */

const SUITE_HOSTS = new Set([
  'dev.cloudcorecollab.com',
  'portal.cloudcorecollab.com',
]);

export function isSuiteHost(hostname: string = window.location.hostname): boolean {
  if (SUITE_HOSTS.has(hostname)) return true;
  // Local opt-in: vite --mode or ?suite=1 is not required; use env.
  if (import.meta.env.VITE_SUITE_HOST === 'true') return true;
  return false;
}

export type SuiteAppId = 'recording' | 'fax';

export type SuiteApp = {
  id: SuiteAppId;
  name: string;
  description: string;
  href: string;
  licensed: boolean;
};

/** Product entry URLs for the current environment. */
export function suiteApps(): SuiteApp[] {
  const host = window.location.hostname;
  const isProdPortal = host === 'portal.cloudcorecollab.com';
  const recording = isProdPortal
    ? 'https://record.cloudcorecollab.com'
    : 'https://recorddev.cloudcorecollab.com';
  const fax = isProdPortal
    ? 'https://fax.cloudcorecollab.com'
    : 'https://faxdev.cloudcorecollab.com';

  // Dev default: both products licensed until a suite entitlements API exists.
  return [
    {
      id: 'recording',
      name: 'CloudCoreRecord',
      description: 'Call recording, search, and retention',
      href: recording,
      licensed: true,
    },
    {
      id: 'fax',
      name: 'CloudCoreFax',
      description: 'Cloud fax inbox, outbound, and Webex Calling lines',
      href: fax,
      licensed: true,
    },
  ];
}
