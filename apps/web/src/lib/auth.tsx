'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { getSession, setSession, type Session } from './api';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  logout: () => void;
  hasPermission: (perm: string) => boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  logout: () => undefined,
  hasPermission: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setState] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setState(getSession());
    setLoading(false);
  }, []);

  const logout = () => {
    setSession(null);
    setState(null);
    router.push('/login');
  };

  const hasPermission = (perm: string) =>
    session?.user.permissions.includes(perm) ?? false;

  return (
    <AuthContext.Provider value={{ session, loading, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
