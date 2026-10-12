'use client';

import React, { createContext, useContext, useCallback, useSyncExternalStore, useEffect } from 'react';
import { translations, TranslationKey, Language } from '@/locales/translations';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: TranslationKey;
}

const STORAGE_KEY = 'namozlarim_lang';
const FALLBACK_STORAGE_KEY = 'salahtrack_lang';

function isValidLanguage(val: unknown): val is Language {
  return val === 'en' || val === 'ru' || val === 'uz';
}

function getStoredLanguage(): Language | null {
  if (typeof window === 'undefined') return null;
  try {
    const primary = window.localStorage.getItem(STORAGE_KEY);
    if (isValidLanguage(primary)) {
      return primary;
    }
    const fallback = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (isValidLanguage(fallback)) {
      return fallback;
    }
  } catch {
    // ignore
  }
  return null;
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
  lang: 'en',
  setLang: () => {},
  t: translations.en,
});

export const LanguageProvider = ({
  children,
  initialLang = 'en',
}: {
  children: React.ReactNode;
  initialLang?: Language;
}) => {
  const getSnapshot = useCallback((): Language => {
    const saved = getStoredLanguage();
    return saved || initialLang;
  }, [initialLang]);

  const getServerSnapshot = useCallback((): Language => {
    return initialLang;
  }, [initialLang]);

  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Sync cookie so server can pre-render matching language on future reloads
  useEffect(() => {
    try {
      const saved = getStoredLanguage();
      const targetLang = saved || initialLang;
      document.cookie = `${STORAGE_KEY}=${targetLang}; path=/; max-age=31536000; SameSite=Lax`;
      window.localStorage.setItem(STORAGE_KEY, targetLang);
    } catch {
      // ignore
    }
  }, [initialLang]);

  const setLang = useCallback((newLang: Language) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, newLang);
      document.cookie = `${STORAGE_KEY}=${newLang}; path=/; max-age=31536000; SameSite=Lax`;
      window.dispatchEvent(new Event('language-change'));
    } catch (error) {
      console.error('Error saving language:', error);
    }
  }, []);

  const t: TranslationKey = translations[lang] || translations[initialLang] || translations.en;

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
