'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { SafeUser } from '@/lib/auth/guard';

interface AuthContextType {
  user: SafeUser | null;
  loading: boolean;
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
  const router = useRouter();

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
          return json.data.user;
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
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (active) {
            if (json?.success && json?.data?.user) {
              setUser(json.data.user);
            } else {
              setUser(null);
            }
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

  const login = async (data: {
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
      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Network error occurred. Please check your connection.',
      };
    }
  };

  const signup = async (data: {
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
      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Network error occurred. Please check your connection.',
      };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        logout,
        refreshUser,
        setUser,
      }}
    >
      {children}
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
