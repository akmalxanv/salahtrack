import { uz } from './uz.ts';
import { ru } from './ru.ts';
import { en } from './en.ts';
import type { TranslationContent, Language } from './types.ts';

export * from './types.ts';
export { uz, uz as uzTranslations } from './uz.ts';
export { ru, ru as ruTranslations } from './ru.ts';
export { en, en as enTranslations } from './en.ts';

export const translations: Record<Language, TranslationContent> = {
  uz,
  ru,
  en,
};

// Freeze translations dictionaries to guarantee dictionary immutability and prevent prototype tampering
Object.freeze(translations.uz);
Object.freeze(translations.ru);
Object.freeze(translations.en);
Object.freeze(translations);

/**
 * Returns the translations dictionary for the given language.
 * Defaults to 'uz' (Uzbek) if the language is unknown or invalid.
 */
export function getTranslations(lang: unknown): TranslationContent {
  if (lang === 'ru') {
    return translations.ru;
  }
  if (lang === 'en') {
    return translations.en;
  }
  return translations.uz;
}
