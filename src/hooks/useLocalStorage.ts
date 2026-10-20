'use client';

import { useSyncExternalStore, useCallback, useMemo, useEffect } from 'react';

const emptySubscribe = () => () => {};

export function useIsMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  window.addEventListener('local-storage-update', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('local-storage-update', callback);
  };
}

const SSR_COOKIE_KEYS = new Set([
  'salahtrack_daily_prayers',
  'namozlarim_daily_prayers',
  'salahtrack_last_active_date',
  'salahtrack_lang',
  'salahtrack_theme',
]);
const MAX_COOKIE_BYTE_LENGTH = 2048;

function formatCookieValue(key: string, rawSerialized: string): string {
  if (typeof window === 'undefined') return rawSerialized;
  if (key === 'salahtrack_daily_prayers' || key === 'namozlarim_daily_prayers') {
    try {
      const parsed = JSON.parse(rawSerialized);
      if (Array.isArray(parsed)) {
        const rawDate = window.localStorage.getItem('salahtrack_last_active_date');
        const activeDate = rawDate ? JSON.parse(rawDate) : null;
        if (activeDate) {
          return JSON.stringify({ date: activeDate, prayers: parsed });
        }
      }
    } catch {
      // ignore
    }
  }
  return rawSerialized;
}

function syncCookieIfPermitted(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  // Strict SSR cookie whitelist: only small layout/hydration keys may be mirrored to cookies
  if (!SSR_COOKIE_KEYS.has(key)) return;

  const safeKey = key.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safeKey) return;

  const cookieVal = formatCookieValue(key, value);
  const encoded = encodeURIComponent(cookieVal);
  // Protect against HTTP 431 Request Header Fields Too Large
  if (encoded.length > MAX_COOKIE_BYTE_LENGTH) return;

  const isSecure = window.location.protocol === 'https:';
  const secureAttr = isSecure ? '; Secure' : '';
  document.cookie = `${safeKey}=${encoded}; path=/; max-age=31536000; SameSite=Lax${secureAttr}`;
}

export function useLocalStorage<T>(key: string, initialValue: T) {
  const isMounted = useIsMounted();

  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);

  const getServerSnapshot = useCallback(() => {
    if (initialValue !== undefined && initialValue !== null) {
      try {
        return JSON.stringify(initialValue);
      } catch {
        return null;
      }
    }
    return null;
  }, [initialValue]);

  const rawValue = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const storedValue = useMemo<T>(() => {
    if (rawValue === null) return initialValue;
    try {
      const parsed = JSON.parse(rawValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && '__proto__' in parsed) {
        delete (parsed as Record<string, unknown>).__proto__;
      }
      return parsed as T;
    } catch {
      return initialValue;
    }
  }, [rawValue, initialValue]);

  // Sync cookie so server-side rendering on reload can pre-render matching state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const item = window.localStorage.getItem(key);
      const rawVal = item !== null ? item : (initialValue !== undefined && initialValue !== null ? JSON.stringify(initialValue) : null);
      if (rawVal !== null) {
        syncCookieIfPermitted(key, rawVal);
      }
    } catch {
      // ignore
    }
  }, [key, initialValue]);

  const setValue = useCallback(
    (valueOrFn: T | ((prev: T) => T)) => {
      try {
        const currentItem = window.localStorage.getItem(key);
        let currentParsed: T = initialValue;
        if (currentItem !== null) {
          try {
            currentParsed = JSON.parse(currentItem);
          } catch {
            currentParsed = initialValue;
          }
        }
        const nextValue = valueOrFn instanceof Function ? valueOrFn(currentParsed) : valueOrFn;
        const serialized = JSON.stringify(nextValue);
        window.localStorage.setItem(key, serialized);
        syncCookieIfPermitted(key, serialized);
        window.dispatchEvent(new Event('local-storage-update'));
      } catch (error) {
        console.error(`Error saving to localStorage key "${key}":`, error);
      }
    },
    [key, initialValue]
  );

  return [storedValue, setValue, isMounted] as const;
}

// Utility to get current date formatted as YYYY-MM-DD
export function getTodayString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
