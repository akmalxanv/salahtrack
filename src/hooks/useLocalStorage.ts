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
      const item = window.localStorage.getItem(key);
      if (item !== null) {
        document.cookie = `${key}=${encodeURIComponent(item)}; path=/; max-age=31536000; SameSite=Lax`;
      } else if (initialValue !== undefined && initialValue !== null) {
        document.cookie = `${key}=${encodeURIComponent(JSON.stringify(initialValue))}; path=/; max-age=31536000; SameSite=Lax`;
      }
    } catch {
      // ignore
    }
  }, [key, initialValue]);

  const setValue = useCallback(
    (valueOrFn: T | ((prev: T) => T)) => {
      try {
        const currentItem = window.localStorage.getItem(key);
        const currentParsed: T = currentItem !== null ? JSON.parse(currentItem) : initialValue;
        const nextValue = valueOrFn instanceof Function ? valueOrFn(currentParsed) : valueOrFn;
        const serialized = JSON.stringify(nextValue);
        window.localStorage.setItem(key, serialized);
        document.cookie = `${key}=${encodeURIComponent(serialized)}; path=/; max-age=31536000; SameSite=Lax`;
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
