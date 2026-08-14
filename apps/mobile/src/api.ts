import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Default API origin, baked at build time by EAS/Expo:
 * - iOS simulator: http://localhost:4000
 * - Android emulator: http://10.0.2.2:4000
 * - Physical device: http://<your-machine-LAN-IP>:4000
 *
 * The login screen can override this at runtime (Figma's "رابط الخادم" field).
 * That matters because EXPO_PUBLIC_API_URL is fixed inside a built binary, so
 * without an override a single build cannot be pointed at another environment.
 */
export const DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const API_URL_KEY = 'bnp.apiUrl';
// Tokens live in the OS keychain/keystore; only the non-secret profile stays
// in AsyncStorage. SecureStore values should stay small (~2KB platform
// limits), which is also why the tokens are stored individually rather than
// as one session blob.
const ACCESS_TOKEN_KEY = 'bnp.accessToken';
const REFRESH_TOKEN_KEY = 'bnp.refreshToken';
const USER_KEY = 'bnp.user';
const LEGACY_SESSION_KEY = 'bnp.session';

let apiUrl: string = DEFAULT_API_URL;

export function getApiUrl(): string {
  return apiUrl;
}

/** Normalises and persists the API origin; empty input restores the default. */
export async function setApiUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '');
  apiUrl = trimmed || DEFAULT_API_URL;
  if (trimmed) await AsyncStorage.setItem(API_URL_KEY, trimmed);
  else await AsyncStorage.removeItem(API_URL_KEY);
}

/** Restores the stored override. Call once on app start, before any request. */
export async function loadApiUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(API_URL_KEY);
    if (stored) apiUrl = stored;
  } catch {
    /* fall back to the baked default */
  }
  return apiUrl;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    roles: string[];
    permissions: string[];
  };
}

// In-memory copy so every request doesn't await two keychain reads.
let cached: Session | null = null;
let loaded = false;

export async function getSession(): Promise<Session | null> {
  if (loaded) return cached;
  try {
    // One-time migration: drop any pre-SecureStore plaintext session rather
    // than trusting it — the user re-authenticates once.
    await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
    const [accessToken, refreshToken, rawUser] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      AsyncStorage.getItem(USER_KEY),
    ]);
    cached =
      accessToken && refreshToken && rawUser
        ? { accessToken, refreshToken, user: JSON.parse(rawUser) }
        : null;
  } catch {
    cached = null;
  }
  loaded = true;
  return cached;
}

export async function setSession(session: Session | null): Promise<void> {
  cached = session;
  loaded = true;
  if (session) {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, session.accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken),
      AsyncStorage.setItem(USER_KEY, JSON.stringify(session.user)),
    ]);
  } else {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
  }
}

export function hasPermission(session: Session | null, perm: string): boolean {
  return !!session?.user.permissions.includes(perm);
}

/**
 * Registered by App so an unrecoverable 401 (refresh failed or revoked)
 * lands the user back on the login screen instead of a dead screenful of
 * error strings.
 */
let onSessionExpired: (() => void) | null = null;
export function setOnSessionExpired(cb: (() => void) | null): void {
  onSessionExpired = cb;
}

async function refreshSession(): Promise<Session | null> {
  const current = await getSession();
  if (!current) return null;
  try {
    const res = await fetch(`${apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (!res.ok) return null;
    const next = (await res.json()) as Session;
    await setSession(next);
    return next;
  } catch {
    return null;
  }
}

/** Best-effort server-side revocation, then local cleanup. */
export async function logoutEverywhere(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST' }, false);
  } catch {
    /* revocation is best-effort; local cleanup must still happen */
  }
  await setSession(null);
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  retryOn401 = true,
): Promise<T> {
  const session = await getSession();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${apiUrl}${path}`, { ...options, headers });

  if (res.status === 401 && session && retryOn401) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, options, false);
    await setSession(null);
    onSessionExpired?.();
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join(', ')
      : (data?.message ?? data?.error ?? `Request failed (${res.status})`);
    throw new Error(
      typeof message === 'string' ? message : `Request failed (${res.status})`,
    );
  }
  return data as T;
}
