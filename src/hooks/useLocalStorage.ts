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
      return JSON.parse(rawValue) as T;
    } catch {
      return initialValue;
    }
  }, [rawValue, initialValue]);

  // Sync cookie so server-side rendering on reload can pre-render matching state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const isSecure = window.location.protocol === 'https:';
      const secureAttr = isSecure ? '; Secure' : '';
      const item = window.localStorage.getItem(key);
      if (item !== null) {
        document.cookie = `${key}=${encodeURIComponent(item)}; path=/; max-age=31536000; SameSite=Lax${secureAttr}`;
      } else if (initialValue !== undefined && initialValue !== null) {
        document.cookie = `${key}=${encodeURIComponent(JSON.stringify(initialValue))}; path=/; max-age=31536000; SameSite=Lax${secureAttr}`;
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
        const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
        const secureAttr = isSecure ? '; Secure' : '';
        document.cookie = `${key}=${encodeURIComponent(serialized)}; path=/; max-age=31536000; SameSite=Lax${secureAttr}`;
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
