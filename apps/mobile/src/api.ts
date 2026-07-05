import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Point this at the API from the device's perspective:
 * - iOS simulator: http://localhost:4000
 * - Android emulator: http://10.0.2.2:4000
 * - Physical device: http://<your-machine-LAN-IP>:4000
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

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

const KEY = 'bnp.session';

export async function getSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export async function setSession(session: Session | null): Promise<void> {
  if (session) await AsyncStorage.setItem(KEY, JSON.stringify(session));
  else await AsyncStorage.removeItem(KEY);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = await getSession();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join(', ')
      : (data?.message ?? `Request failed (${res.status})`);
    throw new Error(message);
  }
  return data as T;
}
