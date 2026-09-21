import type * as ApiModule from './api';

/**
 * `src/lib/api.ts` is the web app's session layer: it attaches the bearer
 * token, refreshes it once on a 401, and sends the user to `/login` when the
 * refresh fails. Until this file, nothing ran it — the browser smoke drives a
 * logged-in flow but never lets a token expire. Every test loads a fresh copy
 * of the module so `API_URL` and the storage state start clean.
 */
declare const __resetBrowser: () => void;

const SESSION: ApiModule.Session = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  user: {
    id: 'u1',
    email: 'nurse@example.com',
    fullName: 'Nurse One',
    roles: ['NURSE_USER'],
    permissions: ['ai:ask'],
  },
};

async function load(): Promise<typeof ApiModule> {
  jest.resetModules();
  return import('./api');
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function brokenResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('not json');
    },
  } as unknown as Response;
}

/** Every fetch call made so far, as [url, init] pairs. */
function calls(): [string, RequestInit][] {
  return (global.fetch as jest.Mock).mock.calls as [string, RequestInit][];
}

function headersOf(call: [string, RequestInit]): Record<string, string> {
  return call[1].headers as Record<string, string>;
}

beforeEach(() => {
  __resetBrowser();
  global.fetch = jest.fn();
});

describe('session storage', () => {
  it('starts with no session', async () => {
    const api = await load();
    expect(api.getSession()).toBeNull();
  });

  it('round-trips a session under the documented key', async () => {
    const api = await load();
    api.setSession(SESSION);
    expect(localStorage.getItem('bnp.session')).toBe(JSON.stringify(SESSION));
    expect(api.getSession()).toEqual(SESSION);
  });

  it('clears the key when the session is set to null', async () => {
    const api = await load();
    api.setSession(SESSION);
    api.setSession(null);
    expect(localStorage.getItem('bnp.session')).toBeNull();
    expect(api.getSession()).toBeNull();
  });

  it('treats a corrupt stored value as no session rather than throwing', async () => {
    const api = await load();
    localStorage.setItem('bnp.session', '{not json');
    expect(api.getSession()).toBeNull();
  });
});

describe('request shaping', () => {
  it('sends the bearer token from the stored session', async () => {
    const api = await load();
    api.setSession(SESSION);
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await api.api('/users/me');

    expect(calls()[0][0]).toBe(`${api.API_URL}/users/me`);
    expect(headersOf(calls()[0]).Authorization).toBe('Bearer access-1');
  });

  it('sends no Authorization header without a session', async () => {
    const api = await load();
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, {}));

    await api.api('/health');

    expect(headersOf(calls()[0]).Authorization).toBeUndefined();
  });

  it('marks a string body as JSON and leaves other bodies alone', async () => {
    const api = await load();
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, {}));

    await api.api('/chat/ask', { method: 'POST', body: JSON.stringify({ question: 'q' }) });
    await api.api('/documents/upload', { method: 'POST', body: new FormData() });

    expect(headersOf(calls()[0])['Content-Type']).toBe('application/json');
    // A multipart body must keep the browser-generated boundary, which a
    // hand-set Content-Type would destroy.
    expect(headersOf(calls()[1])['Content-Type']).toBeUndefined();
  });
});

describe('refresh on 401', () => {
  it('refreshes once with the stored refresh token and retries the original request', async () => {
    const api = await load();
    api.setSession(SESSION);
    const renewed = { ...SESSION, accessToken: 'access-2', refreshToken: 'refresh-2' };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { message: 'jwt expired' }))
      .mockResolvedValueOnce(jsonResponse(200, renewed))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'u1' }));

    const result = await api.api('/users/me');

    expect(result).toEqual({ id: 'u1' });
    expect(calls()).toHaveLength(3);

    const [, refresh, retry] = calls();
    expect(refresh[0]).toBe(`${api.API_URL}/auth/refresh`);
    expect(refresh[1].method).toBe('POST');
    expect(JSON.parse(refresh[1].body as string)).toEqual({ refreshToken: 'refresh-1' });
    // The refresh call itself carries no bearer: the access token just failed.
    expect(headersOf(refresh).Authorization).toBeUndefined();

    expect(retry[0]).toBe(`${api.API_URL}/users/me`);
    expect(headersOf(retry).Authorization).toBe('Bearer access-2');
    expect(api.getSession()).toEqual(renewed);
    expect(window.location.href).toBe('/');
  });

  it('retries exactly once — a second 401 is surfaced, not looped', async () => {
    const api = await load();
    api.setSession(SESSION);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { message: 'jwt expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { ...SESSION, accessToken: 'access-2' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'still no' }));

    await expect(api.api('/users/me')).rejects.toMatchObject({ status: 401, message: 'still no' });
    // original, refresh, retry — and no second refresh.
    expect(calls()).toHaveLength(3);
    expect(calls().filter((c) => c[0].endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('clears the session and sends the user to /login when the refresh is refused', async () => {
    const api = await load();
    api.setSession(SESSION);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { message: 'jwt expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Refresh token has been revoked' }));

    await expect(api.api('/users/me')).rejects.toBeInstanceOf(api.ApiError);

    expect(api.getSession()).toBeNull();
    expect(localStorage.getItem('bnp.session')).toBeNull();
    expect(window.location.href).toBe('/login');
    expect(calls()).toHaveLength(2);
  });

  it('does not attempt a refresh when there is no session to refresh with', async () => {
    const api = await load();
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }));

    await expect(api.api('/users/me')).rejects.toMatchObject({ status: 401 });

    expect(calls()).toHaveLength(1);
    expect(window.location.href).toBe('/login');
  });

  it('lets a caller opt out of the retry', async () => {
    const api = await load();
    api.setSession(SESSION);
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(401, { message: 'no' }));

    await expect(api.api('/users/me', { retryOn401: false })).rejects.toMatchObject({ status: 401 });

    expect(calls()).toHaveLength(1);
    // Opting out of the retry also opts out of the redirect: the caller
    // asked to handle the 401 itself.
    expect(api.getSession()).toEqual(SESSION);
    expect(window.location.href).toBe('/');
  });

  it('survives two requests expiring at once', async () => {
    // The API's /auth/refresh does not rotate: the old refresh token stays
    // valid until it expires (auth.service.ts, refresh()). So two parallel
    // refreshes with the same token both succeed, and whichever lands last
    // is the session. Sharing one in-flight refresh would be an optimisation,
    // not a correctness requirement — this pins the requirement.
    const api = await load();
    api.setSession(SESSION);
    (global.fetch as jest.Mock).mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse(200, { ...SESSION, accessToken: 'access-2' });
      }
      const bearer = (init.headers as Record<string, string>).Authorization;
      return bearer === 'Bearer access-2'
        ? jsonResponse(200, { path: url })
        : jsonResponse(401, { message: 'jwt expired' });
    });

    const [a, b] = await Promise.all([api.api('/users/me'), api.api('/notifications')]);

    expect(a).toEqual({ path: `${api.API_URL}/users/me` });
    expect(b).toEqual({ path: `${api.API_URL}/notifications` });
    expect(api.getSession()?.accessToken).toBe('access-2');
    expect(window.location.href).toBe('/');
  });
});

describe('error envelope', () => {
  it('surfaces the API message and status, and never refreshes on a non-401', async () => {
    const api = await load();
    api.setSession(SESSION);
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(403, { statusCode: 403, message: 'Forbidden resource' }),
    );

    await expect(api.api('/audit-logs')).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden resource',
    });
    expect(calls()).toHaveLength(1);
  });

  it('joins a validation array into one message', async () => {
    const api = await load();
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(400, { message: ['email must be an email', 'password too short'] }),
    );

    await expect(api.api('/users', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      message: 'email must be an email, password too short',
    });
  });

  it('falls back to a status-only message when the body is not JSON', async () => {
    const api = await load();
    (global.fetch as jest.Mock).mockResolvedValueOnce(brokenResponse(502));

    await expect(api.api('/health')).rejects.toMatchObject({
      status: 502,
      message: 'Request failed (502)',
    });
    // A 5xx is not an auth failure; the session is untouched.
    expect(window.location.href).toBe('/');
  });
});
