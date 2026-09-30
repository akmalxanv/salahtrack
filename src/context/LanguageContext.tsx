'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, TranslationKey } from '@/locales/translations';

type Language = 'ru' | 'en' | 'uz';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: TranslationKey;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'ru',
  setLang: () => {},
  t: translations.ru,
});

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [lang, setLangState] = useState<Language>('ru');

  useEffect(() => {
    const saved = localStorage.getItem('qaza_app_lang') as Language;
    if (saved && ['ru', 'en', 'uz'].includes(saved)) {
      setLangState(saved);
    }
  }, []);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('qaza_app_lang', newLang);
  };

  const t: TranslationKey = (translations[lang] || translations.ru) as TranslationKey;

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
