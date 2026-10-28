// Invitations and confirmations issued outside this browser have no local PKCE verifier.
// Consume their fragment tokens explicitly; ordinary in-browser recovery still uses PKCE.
export function emailCallbackTokens(location: { pathname: string; hash: string; search: string }) {
  if (!['/auth/reset', '/auth/login', '/'].includes(location.pathname)) return null;
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (
    !['signup', 'invite', 'recovery'].includes(hash.get('type') ?? '') ||
    hash.has('error') ||
    hash.has('error_code')
  )
    return null;
  const access_token = hash.get('access_token'),
    refresh_token = hash.get('refresh_token');
  if (
    !access_token ||
    !refresh_token ||
    access_token.length > 16384 ||
    refresh_token.length > 2048 ||
    new URLSearchParams(location.search).has('code')
  )
    return null;
  return { access_token, refresh_token };
}
