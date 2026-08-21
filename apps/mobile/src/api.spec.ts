import type * as ApiModule from './api';
import type * as SecureStoreMock from '../test/mocks/expo-secure-store';
import type * as AsyncStorageMock from '../test/mocks/async-storage';

/**
 * `src/api.ts` keeps module-level state — the cached session, the `loaded`
 * flag, the current API origin. Every test therefore loads a *fresh* copy of
 * the module rather than trying to unwind that state, which is also the only
 * honest way to exercise `getSession`'s one-shot read.
 *
 * The mocks are imported through the same reset registry so a test inspects
 * the exact store instance the module under test just wrote to.
 */
interface Loaded {
  api: typeof ApiModule;
  secure: typeof SecureStoreMock;
  storage: typeof AsyncStorageMock;
}

async function load(): Promise<Loaded> {
  jest.resetModules();
  const secure = await import('../test/mocks/expo-secure-store');
  const storage = await import('../test/mocks/async-storage');
  secure.__reset();
  storage.__reset();
  const api = await import('./api');
  return { api, secure, storage };
}

/**
 * Loads the module with a session already in storage, without going through
 * `setSession` — mirroring an app restart, where the tokens were written by a
 * previous run and the in-memory cache starts empty.
 */
async function loadWithStoredSession(): Promise<Loaded> {
  const ctx = await load();
  await ctx.secure.setItemAsync('bnp.accessToken', 'access-1');
  await ctx.secure.setItemAsync('bnp.refreshToken', 'refresh-1');
  await ctx.storage.default.setItem(
    'bnp.user',
    JSON.stringify({
      id: 'u1',
      email: 'nurse@example.com',
      fullName: 'Nurse One',
      roles: ['NURSE_USER'],
      permissions: ['ai:ask'],
    }),
  );
  return ctx;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Every fetch call made so far, as [url, init] pairs. */
function calls(): [string, RequestInit][] {
  return (global.fetch as jest.Mock).mock.calls as [string, RequestInit][];
}

beforeEach(() => {
  global.fetch = jest.fn();
});

describe('API origin', () => {
  it('strips trailing slashes and surrounding whitespace before persisting', async () => {
    const { api, storage } = await load();
    await api.setApiUrl('  https://api.example.org///  ');
    expect(api.getApiUrl()).toBe('https://api.example.org');
    expect(storage.__entries()['bnp.apiUrl']).toBe('https://api.example.org');
  });

  it('restores the baked default and clears storage when cleared', async () => {
    const { api, storage } = await load();
    await api.setApiUrl('https://api.example.org');
    await api.setApiUrl('   ');
    expect(api.getApiUrl()).toBe(api.DEFAULT_API_URL);
    expect(storage.__entries()['bnp.apiUrl']).toBeUndefined();
  });

  it('loads a stored override on start', async () => {
    const { api, storage } = await load();
    await storage.default.setItem('bnp.apiUrl', 'https://stored.example.org');
    expect(await api.loadApiUrl()).toBe('https://stored.example.org');
    expect(api.getApiUrl()).toBe('https://stored.example.org');
  });

  it('falls back to the default when storage is unreadable', async () => {
    const { api, storage } = await load();
    storage.__failWith(new Error('storage unavailable'));
    await expect(api.loadApiUrl()).resolves.toBe(api.DEFAULT_API_URL);
  });

  it('sends requests to the overridden origin', async () => {
    const { api } = await load();
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { ok: true }));
    await api.setApiUrl('https://api.example.org/');
    await api.api('/health');
    expect(calls()[0][0]).toBe('https://api.example.org/health');
  });
});

describe('session storage', () => {
  it('keeps tokens out of plaintext storage', async () => {
    const { api, secure, storage } = await load();
    await api.setSession({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: {
        id: 'u1',
        email: 'nurse@example.com',
        fullName: 'Nurse One',
        roles: ['NURSE_USER'],
        permissions: ['ai:ask'],
      },
    });

    expect(secure.__entries()).toEqual({
      'bnp.accessToken': 'access-1',
      'bnp.refreshToken': 'refresh-1',
    });
    // The whole point of the SecureStore split: nothing in AsyncStorage may
    // contain either token, under any key.
    const plaintext = JSON.stringify(storage.__entries());
    expect(plaintext).not.toContain('access-1');
    expect(plaintext).not.toContain('refresh-1');
    expect(JSON.parse(storage.__entries()['bnp.user']).email).toBe('nurse@example.com');
  });

  it('clears both stores when the session is dropped', async () => {
    const { api, secure, storage } = await loadWithStoredSession();
    await api.setSession(null);
    expect(secure.__entries()).toEqual({});
    expect(storage.__entries()['bnp.user']).toBeUndefined();
    expect(await api.getSession()).toBeNull();
  });

  it('purges any pre-SecureStore plaintext session on first read', async () => {
    const { api, storage } = await load();
    await storage.default.setItem('bnp.session', JSON.stringify({ accessToken: 'leaked' }));
    await api.getSession();
    expect(storage.__entries()['bnp.session']).toBeUndefined();
  });

  it('refuses a half-written session rather than composing a broken one', async () => {
    const { api, secure } = await load();
    await secure.setItemAsync('bnp.accessToken', 'access-1');
    // No refresh token and no stored profile.
    expect(await api.getSession()).toBeNull();
  });

  it('reads a session written by a previous app run', async () => {
    const { api } = await loadWithStoredSession();
    const session = await api.getSession();
    expect(session?.accessToken).toBe('access-1');
    expect(session?.user.fullName).toBe('Nurse One');
  });

  it('treats unreadable storage as signed out instead of throwing', async () => {
    const { api, storage } = await loadWithStoredSession();
    storage.__failWith(new Error('storage unavailable'));
    expect(await api.getSession()).toBeNull();
  });
});

describe('hasPermission', () => {
  it('is false without a session and reflects the granted list otherwise', async () => {
    const { api } = await load();
    const session = {
      accessToken: 'a',
      refreshToken: 'r',
      user: {
        id: 'u1',
        email: 'n@example.com',
        fullName: 'N',
        roles: ['NURSE_USER'],
        permissions: ['ai:ask', 'dose:calculate'],
      },
    };
    expect(api.hasPermission(null, 'ai:ask')).toBe(false);
    expect(api.hasPermission(session, 'ai:ask')).toBe(true);
    expect(api.hasPermission(session, 'documents:download')).toBe(false);
  });
});

describe('api()', () => {
  it('attaches the bearer token, and Content-Type only when there is a body', async () => {
    const { api } = await loadWithStoredSession();
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { ok: true }));

    await api.api('/rag/ask', { method: 'POST', body: JSON.stringify({ q: 'x' }) });
    await api.api('/analytics/overview');

    const [withBody, withoutBody] = calls();
    expect((withBody[1].headers as Record<string, string>).Authorization).toBe(
      'Bearer access-1',
    );
    expect((withBody[1].headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(
      (withoutBody[1].headers as Record<string, string>)['Content-Type'],
    ).toBeUndefined();
  });

  it('sends no Authorization header when signed out', async () => {
    const { api } = await load();
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, {}));
    await api.api('/health');
    expect((calls()[0][1].headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('surfaces a validation error array as one readable message', async () => {
    const { api } = await load();
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(400, { message: ['weight must be positive', 'dose is required'] }),
    );
    await expect(api.api('/dose/calculate')).rejects.toThrow(
      'weight must be positive, dose is required',
    );
  });

  it('falls back to the status code when the body carries no message', async () => {
    const { api } = await load();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(api.api('/health')).rejects.toThrow('Request failed (502)');
  });
});

describe('401 handling', () => {
  it('refreshes once and replays the request with the new token', async () => {
    const { api, secure } = await loadWithStoredSession();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          user: {
            id: 'u1',
            email: 'nurse@example.com',
            fullName: 'Nurse One',
            roles: ['NURSE_USER'],
            permissions: ['ai:ask'],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { answer: 'ok' }));

    await expect(api.api<{ answer: string }>('/rag/ask')).resolves.toEqual({
      answer: 'ok',
    });

    const [first, refresh, replay] = calls();
    expect(first[0]).toContain('/rag/ask');
    expect(refresh[0]).toContain('/auth/refresh');
    expect(JSON.parse(refresh[1].body as string)).toEqual({ refreshToken: 'refresh-1' });
    expect((replay[1].headers as Record<string, string>).Authorization).toBe(
      'Bearer access-2',
    );
    expect(secure.__entries()['bnp.accessToken']).toBe('access-2');
  });

  it('does not loop when the replayed request is also rejected', async () => {
    const { api } = await loadWithStoredSession();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          user: {
            id: 'u1',
            email: 'nurse@example.com',
            fullName: 'Nurse One',
            roles: ['NURSE_USER'],
            permissions: ['ai:ask'],
          },
        }),
      )
      .mockResolvedValue(jsonResponse(401, { message: 'nope' }));

    await expect(api.api('/rag/ask')).rejects.toThrow('nope');
    // original + refresh + one replay, and no second refresh attempt.
    expect(calls()).toHaveLength(3);
    expect(calls().filter(([url]) => url.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('signs the user out and notifies the app when refresh fails', async () => {
    const { api, secure, storage } = await loadWithStoredSession();
    const expired = jest.fn();
    api.setOnSessionExpired(expired);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'refresh revoked' }));

    await expect(api.api('/rag/ask')).rejects.toThrow('expired');
    expect(expired).toHaveBeenCalledTimes(1);
    expect(secure.__entries()).toEqual({});
    expect(storage.__entries()['bnp.user']).toBeUndefined();
  });

  it('signs the user out when the refresh request itself cannot be made', async () => {
    const { api, secure } = await loadWithStoredSession();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
      .mockRejectedValueOnce(new Error('network down'));

    await expect(api.api('/rag/ask')).rejects.toThrow('expired');
    expect(secure.__entries()).toEqual({});
  });

  it('leaves a 401 on an unauthenticated request alone', async () => {
    const { api } = await load();
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, { message: 'no' }));
    await expect(api.api('/rag/ask')).rejects.toThrow('no');
    // Nothing to refresh with, so exactly one request and no /auth/refresh.
    expect(calls()).toHaveLength(1);
  });
});

describe('logoutEverywhere', () => {
  it('revokes server-side and then clears local storage', async () => {
    const { api, secure } = await loadWithStoredSession();
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { ok: true }));
    await api.logoutEverywhere();
    expect(calls()[0][0]).toContain('/auth/logout');
    expect(secure.__entries()).toEqual({});
  });

  it('still clears local storage when revocation fails', async () => {
    const { api, secure, storage } = await loadWithStoredSession();
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    await api.logoutEverywhere();
    expect(secure.__entries()).toEqual({});
    expect(storage.__entries()['bnp.user']).toBeUndefined();
  });
});
