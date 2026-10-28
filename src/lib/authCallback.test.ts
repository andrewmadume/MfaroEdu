import { describe, it, expect } from 'vitest';
import { emailCallbackTokens } from './authCallback';
const location = {
  pathname: '/auth/reset',
  search: '',
  hash: '#access_token=synthetic-access&refresh_token=synthetic-refresh&type=signup',
};
describe('external email callbacks', () => {
  it('accepts complete confirmation, invitation and recovery callbacks only on supported routes', () => {
    for (const type of ['signup', 'invite', 'recovery'])
      expect(
        emailCallbackTokens({ ...location, hash: location.hash.replace('signup', type) }),
      ).toEqual({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
    expect(emailCallbackTokens({ ...location, pathname: '/finance' })).toBeNull();
  });
  it('rejects incomplete, oversized and ambiguous callbacks', () => {
    expect(emailCallbackTokens({ ...location, hash: '#access_token=a&type=recovery' })).toBeNull();
    expect(emailCallbackTokens({ ...location, hash: location.hash + '&error=expired' })).toBeNull();
    expect(emailCallbackTokens({ ...location, search: '?code=synthetic-code' })).toBeNull();
    expect(
      emailCallbackTokens({
        ...location,
        hash: '#access_token=' + 'x'.repeat(16385) + '&refresh_token=b&type=recovery',
      }),
    ).toBeNull();
  });
  it('leaves ordinary PKCE callbacks for the SDK to exchange', () =>
    expect(
      emailCallbackTokens({ ...location, search: '?code=synthetic-code', hash: '' }),
    ).toBeNull());
});
