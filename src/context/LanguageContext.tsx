'use client';

import React, { createContext, useContext, useCallback, useSyncExternalStore, useEffect } from 'react';
import {
  translations,
  TranslationKey,
  Language,
  STORAGE_KEY,
  FALLBACK_STORAGE_KEY,
  isValidLanguage,
  getStoredLanguage,
  getTranslations,
} from '@/locales/translations';

export { STORAGE_KEY, FALLBACK_STORAGE_KEY, isValidLanguage, getStoredLanguage };

/**
 * Safely writes language selection to both primary and fallback cookies
 * with secure flags: Path=/, max-age=1 year, SameSite=Lax, and Secure on HTTPS.
 */
export function writeLanguageCookies(lang: Language): void {
  if (!isValidLanguage(lang) || typeof document === 'undefined') return;
  try {
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const cookieAttributes = `path=/; max-age=31536000; SameSite=Lax${isHttps ? '; Secure' : ''}`;
    document.cookie = `${STORAGE_KEY}=${lang}; ${cookieAttributes}`;
    document.cookie = `${FALLBACK_STORAGE_KEY}=${lang}; ${cookieAttributes}`;
  } catch {
    // Sandbox or restricted cookie storage access
  }
}

/**
 * Safely writes language selection to localStorage
 */
export function writeLanguageStorage(lang: Language): void {
  if (!isValidLanguage(lang) || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, lang);
  } catch {
    // Private browsing or restricted localStorage quota
  }
}

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: TranslationKey;
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  window.addEventListener('language-change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('language-change', callback);
  };
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'uz',
  setLang: () => {},
  t: translations.uz,
});

export const LanguageProvider = ({
  children,
  initialLang = 'uz',
}: {
  children: React.ReactNode;
  initialLang?: Language;
}) => {
  const getSnapshot = useCallback((): Language => {
    const saved = getStoredLanguage();
    if (saved && isValidLanguage(saved)) {
      return saved;
    }
    return isValidLanguage(initialLang) ? initialLang : 'uz';
  }, [initialLang]);

  const getServerSnapshot = useCallback((): Language => {
    return isValidLanguage(initialLang) ? initialLang : 'uz';
  }, [initialLang]);

  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Sync cookie so server can pre-render matching language on future reloads
  useEffect(() => {
    try {
      const saved = getStoredLanguage();
      const targetLang: Language =
        saved && isValidLanguage(saved)
          ? saved
          : isValidLanguage(initialLang)
            ? initialLang
            : 'uz';
      writeLanguageCookies(targetLang);
      writeLanguageStorage(targetLang);
    } catch {
      // ignore
    }
  }, [initialLang]);

  const setLang = useCallback((newLang: Language) => {
    // Strict allowlist validation against prototype pollution & parameter injection
    if (!isValidLanguage(newLang)) {
      console.warn(`[Security] Invalid language rejected: ${String(newLang)}`);
      return;
    }
    try {
      writeLanguageStorage(newLang);
      writeLanguageCookies(newLang);
      window.dispatchEvent(new Event('language-change'));
    } catch (error) {
      console.error('Error saving language:', error);
    }
  }, []);

  const t: TranslationKey = getTranslations(lang);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
