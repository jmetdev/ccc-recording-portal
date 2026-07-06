// PKCE authorization-code flow against Keycloak (or any OIDC IdP), then a
// portal token exchange so the rest of the app runs on local JWTs.

const VERIFIER_KEY = 'sso_code_verifier';
const ISSUER_KEY = 'sso_issuer';
const CLIENT_KEY = 'sso_client_id';

type DiscoveryDoc = {
  authorization_endpoint: string;
  token_endpoint: string;
};

function base64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

async function discover(issuer: string): Promise<DiscoveryDoc> {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error('OIDC discovery failed');
  return res.json();
}

export function ssoRedirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

export async function beginSsoLogin(issuer: string, clientId: string): Promise<void> {
  const doc = await discover(issuer);
  const verifier = randomVerifier();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(ISSUER_KEY, issuer);
  sessionStorage.setItem(CLIENT_KEY, clientId);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: ssoRedirectUri(),
    scope: 'openid profile email',
    code_challenge: await s256(verifier),
    code_challenge_method: 'S256',
  });
  window.location.assign(`${doc.authorization_endpoint}?${params}`);
}

// Returns the IdP access token; caller exchanges it for portal tokens.
export async function completeSsoLogin(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  if (error) throw new Error(params.get('error_description') || error);
  const code = params.get('code');
  if (!code) throw new Error('Missing authorization code');

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const issuer = sessionStorage.getItem(ISSUER_KEY);
  const clientId = sessionStorage.getItem(CLIENT_KEY);
  if (!verifier || !issuer || !clientId) throw new Error('SSO session state lost; try again');
  sessionStorage.removeItem(VERIFIER_KEY);

  const doc = await discover(issuer);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: ssoRedirectUri(),
    code_verifier: verifier,
  });
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error('IdP token exchange failed');
  const tokens = (await res.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error('IdP returned no access token');
  return tokens.access_token;
}
