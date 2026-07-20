import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, User } from '../api/client';
import { clearOidcToken, getOidcToken } from '../suite/api';
import { ssoLogout } from './oidc';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const login = async (username: string, password: string) => {
    const tokens = await api.login(username, password);
    localStorage.setItem('access_token', tokens.access_token);
    localStorage.setItem('refresh_token', tokens.refresh_token);
    setUser(await api.me());
  };

  const logout = () => {
    const idToken = getOidcToken();
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    clearOidcToken();
    setUser(null);
    // End the Keycloak SSO session too, otherwise "sign out" only drops local
    // tokens and the next login silently re-uses the session (can't switch
    // users). ssoLogout redirects the browser when there's a session to end;
    // fall back to a local redirect for plain username/password logins.
    ssoLogout(idToken).then((redirected) => {
      if (!redirected) window.location.assign('/login');
    });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
