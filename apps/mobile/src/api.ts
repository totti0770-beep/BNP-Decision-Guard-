import AsyncStorage from '@react-native-async-storage/async-storage';

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

const SESSION_KEY = 'bnp.session';
const API_URL_KEY = 'bnp.apiUrl';

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

export async function getSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export async function setSession(session: Session | null): Promise<void> {
  if (session) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else await AsyncStorage.removeItem(SESSION_KEY);
}

export function hasPermission(session: Session | null, perm: string): boolean {
  return !!session?.user.permissions.includes(perm);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = await getSession();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${apiUrl}${path}`, { ...options, headers });
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
