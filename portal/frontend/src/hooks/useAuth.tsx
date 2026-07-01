import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, User } from '../api/client';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (perm: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api.me().then(setUser).catch(() => localStorage.removeItem('access_token')).finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const tokens = await api.login(username, password);
    localStorage.setItem('access_token', tokens.access_token);
    const me = await api.me();
    setUser(me);
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    setUser(null);
  };

  const hasPermission = (perm: string) => user?.permissions.includes(perm) ?? false;

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
