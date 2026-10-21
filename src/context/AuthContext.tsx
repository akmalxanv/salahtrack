'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { SafeUser } from '@/lib/auth/guard';
import SessionExpiredModal from '@/components/auth/SessionExpiredModal';

const STORAGE_KEY_MODE = 'salahtrack_mode';
const STORAGE_KEY_HAD_SESSION = 'salahtrack_had_session';

interface AuthContextType {
  user: SafeUser | null;
  loading: boolean;
  isGuest: boolean;
  setGuestMode: (val: boolean) => void;
  sessionExpired: boolean;
  dismissSessionExpired: () => void;
  login: (data: { identifier: string; password: string; rememberMe?: boolean }) => Promise<{ success: boolean; error?: string }>;
  signup: (data: { name: string; username: string; email: string; password: string; confirmPassword?: string }) => Promise<{ success: boolean; error?: string; errors?: Record<string, string> }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<SafeUser | null>;
  setUser: React.Dispatch<React.SetStateAction<SafeUser | null>>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  initialUser?: SafeUser | null;
}) {
  const [user, setUser] = useState<SafeUser | null>(initialUser);
  const [loading, setLoading] = useState<boolean>(!initialUser);
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(STORAGE_KEY_MODE) === 'guest';
    }
    return false;
  });
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);
  const router = useRouter();

  const setGuestMode = useCallback((val: boolean) => {
    setIsGuest(val);
    if (typeof window !== 'undefined') {
      if (val) {
        window.localStorage.setItem(STORAGE_KEY_MODE, 'guest');
      } else {
        window.localStorage.removeItem(STORAGE_KEY_MODE);
      }
    }
  }, []);

  const dismissSessionExpired = useCallback(() => {
    setSessionExpired(false);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY_HAD_SESSION);
    }
  }, []);

  // Fetch current user from /api/auth/me using HttpOnly session cookie
  const refreshUser = useCallback(async (): Promise<SafeUser | null> => {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'same-origin',
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.user) {
          setUser(json.data.user);
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY_HAD_SESSION, 'true');
            window.localStorage.removeItem(STORAGE_KEY_MODE);
          }
          setIsGuest(false);
          setSessionExpired(false);
          return json.data.user;
        }
      } else if (res.status === 401) {
        try {
          const errJson = await res.json();
          if (errJson?.code === 'AUTH_SESSION_EXPIRED') {
            const hadSession = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY_HAD_SESSION) === 'true';
            if (hadSession) {
              setSessionExpired(true);
            }
          }
        } catch {
          // ignore
        }
      }
      setUser(null);
      return null;
    } catch (err) {
      console.error('Failed to verify session:', err);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!initialUser) {
      fetch('/api/auth/me', { credentials: 'same-origin' })
        .then(async (res) => {
          if (!active) return;
          if (res.ok) {
            const json = await res.json();
            if (json?.success && json?.data?.user) {
              setUser(json.data.user);
              if (typeof window !== 'undefined') {
                window.localStorage.setItem(STORAGE_KEY_HAD_SESSION, 'true');
                window.localStorage.removeItem(STORAGE_KEY_MODE);
              }
              setIsGuest(false);
              setSessionExpired(false);
            } else {
              setUser(null);
            }
          } else if (res.status === 401) {
            try {
              const errJson = await res.json();
              if (errJson?.code === 'AUTH_SESSION_EXPIRED') {
                const hadSession = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY_HAD_SESSION) === 'true';
                if (hadSession) {
                  setSessionExpired(true);
                }
              }
            } catch {
              // ignore
            }
            setUser(null);
          } else {
            setUser(null);
          }
        })
        .catch(() => {
          if (active) setUser(null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [initialUser]);

  const login = useCallback(
    async (data: {
      identifier: string;
      password: string;
      rememberMe?: boolean;
    }): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(data),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          return {
            success: false,
            error: json.error || 'Authentication failed. Please check your credentials.',
          };
        }

        setUser(json.data.user);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY_HAD_SESSION, 'true');
          window.localStorage.removeItem(STORAGE_KEY_MODE);
        }
        setIsGuest(false);
        setSessionExpired(false);
        return { success: true };
      } catch {
        return {
          success: false,
          error: 'Network error occurred. Please check your connection.',
        };
      }
    },
    []
  );

  const signup = useCallback(
    async (data: {
      name: string;
      username: string;
      email: string;
      password: string;
      confirmPassword?: string;
    }): Promise<{ success: boolean; error?: string; errors?: Record<string, string> }> => {
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(data),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          return {
            success: false,
            error: json.error || 'Registration failed.',
            errors: json.errors,
          };
        }

        setUser(json.data.user);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY_HAD_SESSION, 'true');
          window.localStorage.removeItem(STORAGE_KEY_MODE);
        }
        setIsGuest(false);
        setSessionExpired(false);
        return { success: true };
      } catch {
        return {
          success: false,
          error: 'Network error occurred. Please check your connection.',
        };
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY_HAD_SESSION);
        window.localStorage.removeItem(STORAGE_KEY_MODE);
      }
      setIsGuest(false);
      setSessionExpired(false);
      setUser(null);
      router.push('/login');
      router.refresh();
    }
  }, [router]);

  const contextValue = useMemo(
    () => ({
      user,
      loading,
      isGuest,
      setGuestMode,
      sessionExpired,
      dismissSessionExpired,
      login,
      signup,
      logout,
      refreshUser,
      setUser,
    }),
    [user, loading, isGuest, setGuestMode, sessionExpired, dismissSessionExpired, login, signup, logout, refreshUser]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
      <SessionExpiredModal />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
