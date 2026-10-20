import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  translations,
  isValidLanguage,
  getStoredLanguage,
  STORAGE_KEY,
  FALLBACK_STORAGE_KEY,
  ALLOWED_LANGUAGES,
  sanitizeLanguage,
  getTranslations,
  interpolate as prodInterpolate,
  safeString,
} from '../../src/locales/translations.ts';
import type {
  Language,
  TranslationKey,
} from '../../src/locales/translations.ts';
import {
  consumeRateLimit,
  DEFAULT_PROFILE_RATE_LIMIT,
  createRateLimitKey,
  clearRateLimitStore,
} from '../../src/lib/auth/rate-limit.ts';

/**
 * Recursively collect all dot-delimited key paths and their types from an object.
 */
function extractKeyPaths(
  obj: Record<string, unknown>,
  prefix = ''
): Map<string, { type: string; value: unknown }> {
  const result = new Map<string, { type: string; value: unknown }>();

  for (const [key, val] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      result.set(fullPath, { type: 'object', value: val });
      const nested = extractKeyPaths(val as Record<string, unknown>, fullPath);
      for (const [nKey, nVal] of nested.entries()) {
        result.set(nKey, nVal);
      }
    } else if (Array.isArray(val)) {
      result.set(fullPath, { type: 'array', value: val });
    } else {
      result.set(fullPath, { type: typeof val, value: val });
    }
  }

  return result;
}

/**
 * Extract parameter tokens like {count}, {days}, {date}, and %s from a string.
 */
function extractPlaceholders(text: string): string[] {
  const namedMatches = text.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
  const printfMatches = text.match(/%s/g) || [];
  return [...namedMatches, ...printfMatches].sort();
}

/**
 * Generic interpolation helper replicating frontend string replacement.
 */
function interpolate(
  template: string,
  params: Record<string, string | number> = {},
  printfArg?: string | number
): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  if (printfArg !== undefined) {
    result = result.replace(/%s/g, String(printfArg));
  }
  return result;
}

describe('SalahTrack Localization Engine (i18n) QA Suite', () => {
  const languages: Language[] = ['uz', 'ru', 'en'];

  describe('1. Automated Dictionary Parity & Structure Verification', () => {
    it('defines translations for all supported languages (uz, ru, en) matching TranslationKey', () => {
      for (const lang of languages) {
        const dict: TranslationKey = translations[lang];
        assert.ok(dict, `translations.${lang} must be defined`);
        assert.equal(typeof dict, 'object', `translations.${lang} must be an object`);
        assert.equal(typeof dict.appTitle, 'string', `translations.${lang}.appTitle must be string`);
      }
    });

    it('guarantees 100% key parity between Uzbek (uz) and Russian (ru)', () => {
      const uzKeys = extractKeyPaths(translations.uz as unknown as Record<string, unknown>);
      const ruKeys = extractKeyPaths(translations.ru as unknown as Record<string, unknown>);

      const missingInRu = Array.from(uzKeys.keys()).filter((k) => !ruKeys.has(k));
      const extraInRu = Array.from(ruKeys.keys()).filter((k) => !uzKeys.has(k));

      if (missingInRu.length > 0 || extraInRu.length > 0) {
        console.error('❌ Parity mismatch UZ vs RU:', { missingInRu, extraInRu });
      }

      assert.deepEqual(
        missingInRu,
        [],
        `The following keys exist in 'uz' but are MISSING in 'ru':\n${missingInRu.join('\n')}`
      );
      assert.deepEqual(
        extraInRu,
        [],
        `The following keys exist in 'ru' but are MISSING in 'uz':\n${extraInRu.join('\n')}`
      );
    });

    it('guarantees 100% key parity between Uzbek (uz) and English (en)', () => {
      const uzKeys = extractKeyPaths(translations.uz as unknown as Record<string, unknown>);
      const enKeys = extractKeyPaths(translations.en as unknown as Record<string, unknown>);

      const missingInEn = Array.from(uzKeys.keys()).filter((k) => !enKeys.has(k));
      const extraInEn = Array.from(enKeys.keys()).filter((k) => !uzKeys.has(k));

      if (missingInEn.length > 0 || extraInEn.length > 0) {
        console.error('❌ Parity mismatch UZ vs EN:', { missingInEn, extraInEn });
      }

      assert.deepEqual(
        missingInEn,
        [],
        `The following keys exist in 'uz' but are MISSING in 'en':\n${missingInEn.join('\n')}`
      );
      assert.deepEqual(
        extraInEn,
        [],
        `The following keys exist in 'en' but are MISSING in 'uz':\n${extraInEn.join('\n')}`
      );
    });

    it('enforces matching data types across all dictionary entries', () => {
      const uzPaths = extractKeyPaths(translations.uz as unknown as Record<string, unknown>);
      const ruPaths = extractKeyPaths(translations.ru as unknown as Record<string, unknown>);
      const enPaths = extractKeyPaths(translations.en as unknown as Record<string, unknown>);

      for (const [path, uzInfo] of uzPaths.entries()) {
        const ruInfo = ruPaths.get(path);
        const enInfo = enPaths.get(path);

        assert.ok(ruInfo, `Key path ${path} must exist in Russian dictionary`);
        assert.ok(enInfo, `Key path ${path} must exist in English dictionary`);

        assert.equal(
          ruInfo?.type,
          uzInfo.type,
          `Type mismatch at ${path}: uz is ${uzInfo.type}, ru is ${ruInfo?.type}`
        );
        assert.equal(
          enInfo?.type,
          uzInfo.type,
          `Type mismatch at ${path}: uz is ${uzInfo.type}, en is ${enInfo?.type}`
        );
      }
    });

    it('validates value hygiene: no empty strings, nulls, undefined, or placeholder artifacts', () => {
      const forbiddenTokens = ['TODO', 'FIXME', '[TRANSLATE]', 'NOT_TRANSLATED', 'UNDEFINED', 'NaN', '[object Object]'];

      for (const lang of languages) {
        const paths = extractKeyPaths(translations[lang] as unknown as Record<string, unknown>);
        for (const [path, { type, value }] of paths.entries()) {
          if (type === 'string') {
            const str = value as string;
            assert.ok(
              str.trim().length > 0,
              `Empty or whitespace-only string found in translations.${lang} at key: "${path}"`
            );

            for (const token of forbiddenTokens) {
              assert.ok(
                !str.includes(token),
                `Forbidden token "${token}" detected in translations.${lang} at key: "${path}": "${str}"`
              );
            }
          }
        }
      }
    });

    it('verifies template variable placeholders ({param} and %s) match identically across all languages', () => {
      const uzPaths = extractKeyPaths(translations.uz as unknown as Record<string, unknown>);
      const ruPaths = extractKeyPaths(translations.ru as unknown as Record<string, unknown>);
      const enPaths = extractKeyPaths(translations.en as unknown as Record<string, unknown>);

      for (const [path, { type, value }] of uzPaths.entries()) {
        if (type === 'string') {
          const uzPlaceholders = extractPlaceholders(value as string);
          const ruPlaceholders = extractPlaceholders(ruPaths.get(path)?.value as string);
          const enPlaceholders = extractPlaceholders(enPaths.get(path)?.value as string);

          assert.deepEqual(
            ruPlaceholders,
            uzPlaceholders,
            `Template placeholder mismatch between UZ and RU at key "${path}": UZ has ${JSON.stringify(uzPlaceholders)}, RU has ${JSON.stringify(ruPlaceholders)}`
          );
          assert.deepEqual(
            enPlaceholders,
            uzPlaceholders,
            `Template placeholder mismatch between UZ and EN at key "${path}": UZ has ${JSON.stringify(uzPlaceholders)}, EN has ${JSON.stringify(enPlaceholders)}`
          );
        }
      }
    });
  });

  describe('2. Section-by-Section Parity Across All 20 Top-Level Sections', () => {
    const topLevelSections = [
      'common',
      'nav',
      'auth',
      'prayers',
      'statuses',
      'dashboard',
      'accountability',
      'leaderboard',
      'profile',
      'history',
      'stats',
      'qibla',
      'settings',
      'calculator',
      'qaza',
      'analytics',
      'calendar',
      'groups',
      'progress',
      'account',
      'apiErrors',
    ] as const;

    it('verifies all 21 required top-level sections exist in every language', () => {
      for (const lang of languages) {
        for (const section of topLevelSections) {
          const sectionVal = translations[lang][section];
          assert.ok(
            sectionVal !== undefined && sectionVal !== null,
            `Section "${section}" must be defined in translations.${lang}`
          );
          assert.equal(
            typeof sectionVal,
            'object',
            `Section "${section}" in translations.${lang} must be an object`
          );
        }
      }
    });

    it('verifies "common" section parity and non-empty values', () => {
      const commonKeys = [
        'hoursUnit', 'minsUnit', 'currency', 'activeLocalProfile',
        'loading', 'save', 'saved', 'cancel', 'error', 'success',
      ] as const;
      for (const lang of languages) {
        for (const k of commonKeys) {
          const val = translations[lang].common[k];
          assert.ok(val && typeof val === 'string' && val.trim().length > 0, `common.${k} missing in ${lang}`);
        }
      }
    });

    it('verifies "auth" section parity including all nested auth forms', () => {
      for (const lang of languages) {
        const auth = translations[lang].auth;
        assert.ok(auth.login.title, `auth.login.title missing in ${lang}`);
        assert.ok(auth.login.submit, `auth.login.submit missing in ${lang}`);
        assert.ok(auth.signup.title, `auth.signup.title missing in ${lang}`);
        assert.ok(auth.signup.termsPledge, `auth.signup.termsPledge missing in ${lang}`);
        assert.ok(auth.forgotPassword.title, `auth.forgotPassword.title missing in ${lang}`);
        assert.ok(auth.resetPassword.title, `auth.resetPassword.title missing in ${lang}`);
        assert.ok(auth.validation.passwordRequirements, `auth.validation.passwordRequirements missing in ${lang}`);
        assert.ok(auth.logout.button, `auth.logout.button missing in ${lang}`);
      }
    });

    it('verifies "prayers" and "statuses" sections parity for all 5 daily prayers and 6 statuses', () => {
      const prayerKeys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
      const statusKeys = ['PENDING', 'PRAYED_ON_TIME', 'PRAYED_LATE', 'MISSED', 'MADE_UP', 'PRAYED'] as const;

      for (const lang of languages) {
        for (const p of prayerKeys) {
          const name = translations[lang].prayers[p];
          assert.ok(name && name.trim().length > 0, `prayers.${p} missing in ${lang}`);
        }
        for (const s of statusKeys) {
          const label = translations[lang].statuses[s];
          assert.ok(label && label.trim().length > 0, `statuses.${s} missing in ${lang}`);
        }
      }
    });

    it('verifies "calendar" section parity including 7 weekdays and 12 months array lengths', () => {
      for (const lang of languages) {
        const cal = translations[lang].calendar;
        assert.equal(cal.weekdaysShort.length, 7, `calendar.weekdaysShort must have length 7 in ${lang}`);
        assert.equal(cal.months.length, 12, `calendar.months must have length 12 in ${lang}`);
        assert.ok(cal.legend.perfect && cal.legend.missed && cal.legend.pending);
        assert.ok(cal.summary.prayersCompleted && cal.summary.onTimeRate);
      }
    });

    it('verifies "progress" section parity including all 4 tabs and summary metrics', () => {
      for (const lang of languages) {
        const prog = translations[lang].progress;
        assert.ok(prog.tabs.overview && prog.tabs.history && prog.tabs.analytics && prog.tabs.qaza);
        assert.ok(prog.summary.completionRate && prog.summary.currentStreak && prog.summary.qazaBalance);
        assert.ok(prog.periods.d7 && prog.periods.d30 && prog.periods.custom);
        assert.ok(prog.insights.title && prog.insights.streakEncouragement);
      }
    });

    it('verifies "account" section parity including tabs and security notes', () => {
      for (const lang of languages) {
        const acc = translations[lang].account;
        assert.ok(acc.tabs.profile && acc.tabs.preferences && acc.tabs.privacy && acc.tabs.security);
        assert.ok(acc.sections.personalInfo && acc.sections.security);
        assert.ok(acc.argonSecurityNote && acc.secureSessionTitle);
      }
    });
  });

  describe('3. Placeholder Interpolation & Formatting Robustness', () => {
    it('interpolates method placeholder in dashboard.calcMethodBased correctly across all languages', () => {
      const sampleMethod = 'Muslim World League';
      for (const lang of languages) {
        const raw = translations[lang].dashboard.calcMethodBased;
        assert.ok(raw.includes('{method}'), `calcMethodBased must include {method} in ${lang}`);

        const result = interpolate(raw, { method: sampleMethod });
        assert.ok(!result.includes('{method}'), `Interpolation left unparsed {method} in ${lang}`);
        assert.ok(result.includes(sampleMethod), `Result did not contain inserted method in ${lang}`);
      }
    });

    it('interpolates completed and total placeholders in calendar.dayCompletion cleanly', () => {
      for (const lang of languages) {
        const raw = translations[lang].calendar.dayCompletion;
        assert.ok(raw.includes('{completed}') && raw.includes('{total}'));

        const result = interpolate(raw, { completed: 4, total: 5 });
        assert.ok(!result.includes('{completed}'));
        assert.ok(!result.includes('{total}'));
        assert.ok(result.includes('4') && result.includes('5'));
      }
    });

    it('interpolates count placeholder in progress missed and overdue prayer counts', () => {
      for (const lang of languages) {
        const missedRaw = translations[lang].progress.missedPrayersCount;
        const overdueRaw = translations[lang].progress.overduePrayersCount;

        const missedRes = interpolate(missedRaw, { count: 12 });
        const overdueRes = interpolate(overdueRaw, { count: 3 });

        assert.ok(!missedRes.includes('{count}') && missedRes.includes('12'));
        assert.ok(!overdueRes.includes('{count}') && overdueRes.includes('3'));
      }
    });

    it('interpolates days placeholder in progress overdueBadge', () => {
      for (const lang of languages) {
        const raw = translations[lang].progress.overdueBadge;
        assert.ok(raw.includes('{days}'));

        const result = interpolate(raw, { days: 8 });
        assert.ok(!result.includes('{days}') && result.includes('8'));
      }
    });

    it('interpolates printf-style %s placeholders in qibla turnLeft and turnRight', () => {
      for (const lang of languages) {
        const turnLeftRaw = translations[lang].qibla.turnLeft;
        const turnRightRaw = translations[lang].qibla.turnRight;

        assert.ok(turnLeftRaw.includes('%s'), `qibla.turnLeft must contain %s in ${lang}`);
        assert.ok(turnRightRaw.includes('%s'), `qibla.turnRight must contain %s in ${lang}`);

        const leftRes = interpolate(turnLeftRaw, {}, 35);
        const rightRes = interpolate(turnRightRaw, {}, 14);

        assert.ok(!leftRes.includes('%s') && leftRes.includes('35'));
        assert.ok(!rightRes.includes('%s') && rightRes.includes('14'));
      }
    });

    it('handles edge-case interpolation values: zero, empty string, and unicode symbols safely', () => {
      for (const lang of languages) {
        const raw = translations[lang].progress.missedPrayersCount;

        // Zero value test
        const zeroRes = interpolate(raw, { count: 0 });
        assert.ok(zeroRes.includes('0') && !zeroRes.includes('{count}'));

        // Unicode special characters in method test
        const calcRaw = translations[lang].dashboard.calcMethodBased;
        const unicodeRes = interpolate(calcRaw, { method: "O‘zbekiston Musulmonlari Idorasi" });
        assert.ok(unicodeRes.includes("O‘zbekiston Musulmonlari Idorasi"));
      }
    });
  });

  describe('4. Dynamic Language Resolution & Undefined-Safety', () => {
    it('simulates rapid sequential language switching (uz -> ru -> en -> uz) with zero undefined values', () => {
      let currentLang: Language = 'uz';
      const switchSequence: Language[] = ['ru', 'en', 'uz', 'ru', 'uz'];

      for (const targetLang of switchSequence) {
        assert.ok(isValidLanguage(targetLang), `Target language must be valid: ${targetLang}`);
        currentLang = targetLang;

        const currentDict: TranslationKey = translations[currentLang];
        assert.ok(currentDict, `Dictionary for ${currentLang} must be resolved`);

        // Check essential paths to guarantee no undefined values exist
        assert.ok(currentDict.appTitle !== undefined);
        assert.ok(currentDict.nav.home !== undefined);
        assert.ok(currentDict.prayers.fajr !== undefined);
        assert.ok(currentDict.statuses.PRAYED_ON_TIME !== undefined);
        assert.ok(currentDict.dashboard.todayPrayers !== undefined);
        assert.ok(currentDict.calendar.dayCompletion !== undefined);
        assert.ok(currentDict.qibla.title !== undefined);
        assert.ok(currentDict.progress.tabs.history !== undefined);
        assert.ok(currentDict.account.title !== undefined);
      }
    });

    it('deeply verifies that every single leaf node across all 3 languages is non-null and defined', () => {
      for (const lang of languages) {
        const paths = extractKeyPaths(translations[lang] as unknown as Record<string, unknown>);
        for (const [path, { type, value }] of paths.entries()) {
          assert.notEqual(
            value,
            undefined,
            `Undefined value detected at translations.${lang}.${path}`
          );
          assert.notEqual(
            value,
            null,
            `Null value detected at translations.${lang}.${path}`
          );
          if (type === 'string') {
            assert.notEqual(
              (value as string).trim(),
              '',
              `Empty string detected at translations.${lang}.${path}`
            );
          }
        }
      }
    });
  });

  describe('5. Dynamic Language Validation & Fallback Safety', () => {
    it('accepts valid supported languages (uz, ru, en)', () => {
      assert.equal(isValidLanguage('uz'), true);
      assert.equal(isValidLanguage('ru'), true);
      assert.equal(isValidLanguage('en'), true);
    });

    it('rejects unsupported ISO language codes', () => {
      assert.equal(isValidLanguage('fr'), false);
      assert.equal(isValidLanguage('es'), false);
      assert.equal(isValidLanguage('de'), false);
      assert.equal(isValidLanguage('ar'), false);
      assert.equal(isValidLanguage('tr'), false);
      assert.equal(isValidLanguage('zh'), false);
    });

    it('rejects malformed and boundary inputs', () => {
      assert.equal(isValidLanguage(''), false);
      assert.equal(isValidLanguage('   '), false);
      assert.equal(isValidLanguage('UZ'), false);
      assert.equal(isValidLanguage('RU'), false);
      assert.equal(isValidLanguage('EN'), false);
      assert.equal(isValidLanguage(null), false);
      assert.equal(isValidLanguage(undefined), false);
      assert.equal(isValidLanguage(123), false);
      assert.equal(isValidLanguage(true), false);
      assert.equal(isValidLanguage({ lang: 'uz' }), false);
      assert.equal(isValidLanguage(['uz']), false);
    });

    it('guards against prototype pollution and object property injection', () => {
      assert.equal(isValidLanguage('__proto__'), false);
      assert.equal(isValidLanguage('constructor'), false);
      assert.equal(isValidLanguage('toString'), false);
      assert.equal(isValidLanguage('valueOf'), false);
      assert.equal(isValidLanguage('prototype'), false);
      assert.equal(isValidLanguage('__defineGetter__'), false);
    });

    it('guards against injection vectors (XSS, path traversal, SQL injection)', () => {
      assert.equal(isValidLanguage('<script>alert("xss")</script>'), false);
      assert.equal(isValidLanguage('../../locales'), false);
      assert.equal(isValidLanguage("uz'; DROP TABLE users;--"), false);
      assert.equal(isValidLanguage('uz\0'), false);
      assert.equal(isValidLanguage('en\r\nSet-Cookie: admin=1'), false);
    });
  });

  describe('6. Stored Language Resolution & Fallback Hierarchy', () => {
    const createMockStorage = (store: Record<string, string> = {}) => {
      return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, val: string) => {
          store[key] = val;
        },
      };
    };

    it('retrieves language from primary STORAGE_KEY (namozlarim_lang)', () => {
      const storage = createMockStorage({ [STORAGE_KEY]: 'ru' });
      assert.equal(getStoredLanguage(storage), 'ru');
    });

    it('falls back to FALLBACK_STORAGE_KEY (salahtrack_lang) if primary is missing', () => {
      const storage = createMockStorage({ [FALLBACK_STORAGE_KEY]: 'en' });
      assert.equal(getStoredLanguage(storage), 'en');
    });

    it('prefers primary STORAGE_KEY over FALLBACK_STORAGE_KEY when both exist', () => {
      const storage = createMockStorage({
        [STORAGE_KEY]: 'ru',
        [FALLBACK_STORAGE_KEY]: 'uz',
      });
      assert.equal(getStoredLanguage(storage), 'ru');
    });

    it('falls back to FALLBACK_STORAGE_KEY if primary contains invalid locale', () => {
      const storage = createMockStorage({
        [STORAGE_KEY]: 'invalid_locale',
        [FALLBACK_STORAGE_KEY]: 'en',
      });
      assert.equal(getStoredLanguage(storage), 'en');
    });

    it('returns null when both primary and fallback keys are missing or invalid', () => {
      const emptyStorage = createMockStorage({});
      assert.equal(getStoredLanguage(emptyStorage), null);

      const invalidStorage = createMockStorage({
        [STORAGE_KEY]: 'fr',
        [FALLBACK_STORAGE_KEY]: 'de',
      });
      assert.equal(getStoredLanguage(invalidStorage), null);
    });

    it('handles storage errors safely without throwing uncaught exceptions', () => {
      const faultyStorage = {
        getItem: () => {
          throw new Error('SecurityError: DOMStorage access denied');
        },
      };
      assert.doesNotThrow(() => {
        const result = getStoredLanguage(faultyStorage);
        assert.equal(result, null);
      });
    });
  });

  describe('7. Cookie & LocalStorage Synchronization Simulation', () => {
    it('uses correct storage key constants for multi-brand backward compatibility', () => {
      assert.equal(STORAGE_KEY, 'namozlarim_lang');
      assert.equal(FALLBACK_STORAGE_KEY, 'salahtrack_lang');
    });

    it('simulates synchronous storage and cookie writing on language switch', () => {
      const mockStorage: Record<string, string> = {};
      const mockCookies: string[] = [];

      function simulateSetLang(newLang: string, isHttps = false) {
        if (!isValidLanguage(newLang)) {
          return false;
        }
        mockStorage[STORAGE_KEY] = newLang;
        mockStorage[FALLBACK_STORAGE_KEY] = newLang;

        const cookieAttributes = `path=/; max-age=31536000; SameSite=Lax${isHttps ? '; Secure' : ''}`;
        mockCookies.push(`${STORAGE_KEY}=${newLang}; ${cookieAttributes}`);
        mockCookies.push(`${FALLBACK_STORAGE_KEY}=${newLang}; ${cookieAttributes}`);
        return true;
      }

      // Valid language switch
      const success = simulateSetLang('uz', true);
      assert.equal(success, true);
      assert.equal(mockStorage[STORAGE_KEY], 'uz');
      assert.equal(mockStorage[FALLBACK_STORAGE_KEY], 'uz');
      assert.ok(mockCookies.some((c) => c.startsWith('namozlarim_lang=uz;') && c.includes('Secure')));
      assert.ok(mockCookies.some((c) => c.startsWith('salahtrack_lang=uz;') && c.includes('SameSite=Lax')));

      // Invalid language switch attempt must reject and NOT overwrite existing values
      const rejected = simulateSetLang('malicious_input');
      assert.equal(rejected, false);
      assert.equal(mockStorage[STORAGE_KEY], 'uz', 'Storage must not be modified on invalid language');
    });

    it('verifies all navigation keys exist and map to human-readable strings', () => {
      const requiredNavKeys = [
        'home',
        'progress',
        'leaderboard',
        'qibla',
        'account',
        'history',
        'stats',
        'profile',
        'login',
        'signup',
        'logout',
      ] as const;

      for (const lang of languages) {
        for (const navKey of requiredNavKeys) {
          const val = translations[lang].nav[navKey];
          assert.ok(val, `nav.${navKey} must be defined in translations.${lang}`);
          assert.equal(typeof val, 'string');
          assert.ok(val.trim().length > 0);
        }
      }
    });

    it('verifies prayer name translations exist for all 5 daily prayers', () => {
      const prayerKeys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

      for (const lang of languages) {
        for (const prayer of prayerKeys) {
          const name = translations[lang].prayers[prayer];
          assert.ok(name, `prayers.${prayer} must exist for lang=${lang}`);
          assert.ok(name.trim().length > 0);
        }
      }
    });
  });

  describe('5. Security Audit & Attack Vector Mitigations', () => {
    it('enforces strict allowlist constants matching uz, ru, en', () => {
      assert.deepEqual(Array.from(ALLOWED_LANGUAGES), ['uz', 'ru', 'en']);
    });

    it('sanitizeLanguage normalizes valid locales and sub-tags cleanly', () => {
      assert.equal(sanitizeLanguage('uz'), 'uz');
      assert.equal(sanitizeLanguage('ru'), 'ru');
      assert.equal(sanitizeLanguage('en'), 'en');
      assert.equal(sanitizeLanguage('  EN  '), 'en');
      assert.equal(sanitizeLanguage('RU'), 'ru');
      assert.equal(sanitizeLanguage('uz-UZ'), 'uz');
      assert.equal(sanitizeLanguage('en-US'), 'en');
      assert.equal(sanitizeLanguage('ru-RU'), 'ru');
    });

    it('sanitizeLanguage defeats path traversal and arbitrary string injection', () => {
      assert.equal(sanitizeLanguage('../../etc/passwd'), 'uz');
      assert.equal(sanitizeLanguage('..\\..\\windows\\system32'), 'uz');
      assert.equal(sanitizeLanguage('/var/locales/ru'), 'uz');
      assert.equal(sanitizeLanguage('..%2f..%2fetc%2fpasswd'), 'uz');
    });

    it('sanitizeLanguage defeats prototype pollution attacks', () => {
      assert.equal(sanitizeLanguage('__proto__'), 'uz');
      assert.equal(sanitizeLanguage('constructor'), 'uz');
      assert.equal(sanitizeLanguage('prototype'), 'uz');
      assert.equal(sanitizeLanguage('toString'), 'uz');
      assert.equal(sanitizeLanguage('valueOf'), 'uz');
      assert.equal(sanitizeLanguage('hasOwnProperty'), 'uz');
    });

    it('sanitizeLanguage strips XSS vectors, null bytes, and control characters', () => {
      assert.equal(sanitizeLanguage('<script>alert(1)</script>'), 'uz');
      assert.equal(sanitizeLanguage('javascript:alert(1)'), 'uz');
      assert.equal(sanitizeLanguage('uz\x00'), 'uz');
      assert.equal(sanitizeLanguage('en\r\nSet-Cookie: evil=1'), 'uz');
      assert.equal(sanitizeLanguage(null), 'uz');
      assert.equal(sanitizeLanguage(undefined), 'uz');
      assert.equal(sanitizeLanguage({}), 'uz');
    });

    it('getTranslations guards against prototype lookup and invalid keys', () => {
      assert.equal(getTranslations('uz'), translations.uz);
      assert.equal(getTranslations('ru'), translations.ru);
      assert.equal(getTranslations('en'), translations.en);

      // Malicious or unexpected inputs must safely fall back to default 'uz'
      assert.equal(getTranslations('__proto__'), translations.uz);
      assert.equal(getTranslations('constructor'), translations.uz);
      assert.equal(getTranslations('toString'), translations.uz);
      assert.equal(getTranslations('fr'), translations.uz);
      assert.equal(getTranslations(null), translations.uz);
      assert.equal(getTranslations(undefined), translations.uz);
      assert.equal(getTranslations(123), translations.uz);
    });

    it('guarantees translation dictionaries are deeply frozen (immutable)', () => {
      assert.ok(Object.isFrozen(translations), 'translations object must be frozen');
      assert.ok(Object.isFrozen(translations.uz), 'translations.uz must be frozen');
      assert.ok(Object.isFrozen(translations.ru), 'translations.ru must be frozen');
      assert.ok(Object.isFrozen(translations.en), 'translations.en must be frozen');
    });

    it('prodInterpolate safely replaces named and printf parameters', () => {
      const template = 'User {name} completed {count} prayers with %s method';
      const output = prodInterpolate(template, { name: 'Ahmad', count: 5 }, 'MWL');
      assert.equal(output, 'User Ahmad completed 5 prayers with MWL method');
    });

    it('prodInterpolate blocks prototype pollution and property injection', () => {
      const dirtyParams = Object.create({ inheritedSecret: 'LEAKED' });
      dirtyParams.cleanKey = 'SAFE';

      const template = 'Status: {cleanKey}, Secret: {inheritedSecret}, Proto: {toString}';
      const result = prodInterpolate(template, dirtyParams);

      assert.equal(result, 'Status: SAFE, Secret: {inheritedSecret}, Proto: {toString}');
      assert.ok(!result.includes('LEAKED'));
    });

    it('prodInterpolate strips dangerous control characters from dynamic inputs', () => {
      const maliciousPayload = 'Test\x00Injection\r\nAttack\x1F';
      const template = 'Hello {input}';
      const result = prodInterpolate(template, { input: maliciousPayload });

      assert.equal(result, 'Hello TestInjectionAttack');
      assert.ok(!result.includes('\x00'));
      assert.ok(!result.includes('\r'));
      assert.ok(!result.includes('\n'));
      assert.ok(!result.includes('\x1F'));
    });

    it('safeString removes ASCII control characters and trims', () => {
      assert.equal(safeString('  valid text  '), 'valid text');
      assert.equal(safeString('text\x00with\x1Fcontrol'), 'textwithcontrol');
      assert.equal(safeString(123), '');
      assert.equal(safeString(null), '');
    });

    it('enforces sliding-window rate limit on preference mutations (consumeRateLimit)', () => {
      assert.equal(DEFAULT_PROFILE_RATE_LIMIT.maxAttempts, 30);
      assert.equal(DEFAULT_PROFILE_RATE_LIMIT.windowMs, 60000);

      clearRateLimitStore();
      const testKey = createRateLimitKey('192.168.1.100', 'profile:test-user-123');
      const testConfig = { maxAttempts: 5, windowMs: 10000 };

      // First 5 attempts must succeed
      for (let i = 1; i <= 5; i++) {
        const res = consumeRateLimit(testKey, testConfig);
        assert.equal(res.allowed, true, `Attempt ${i} should be allowed`);
        assert.equal(res.remaining, 5 - i);
      }

      // 6th attempt must be rejected (429 condition)
      const blockedRes = consumeRateLimit(testKey, testConfig);
      assert.equal(blockedRes.allowed, false);
      assert.equal(blockedRes.remaining, 0);
      assert.ok(blockedRes.retryAfterSeconds > 0 && blockedRes.retryAfterSeconds <= 10);

      // Separate user key should NOT be blocked (rate limit isolation)
      const otherKey = createRateLimitKey('192.168.1.101', 'profile:other-user-456');
      const otherRes = consumeRateLimit(otherKey, testConfig);
      assert.equal(otherRes.allowed, true);

      clearRateLimitStore();
    });

    it('verifies next.config.ts exports Content-Security-Policy and cross-origin security headers', async () => {
      const nextConfigModule = await import('../../next.config.ts');
      const config = nextConfigModule.default;
      assert.ok(typeof config.headers === 'function', 'config.headers must be a function');
      const headersList = await config.headers!();
      const globalHeaders = headersList.find((h: { source: string }) => h.source === '/(.*)');
      assert.ok(globalHeaders, 'Global headers must be defined');

      const headerMap = new Map<string, string>();
      for (const h of globalHeaders.headers) {
        headerMap.set(h.key, h.value);
      }

      // CSP verification
      const csp = headerMap.get('Content-Security-Policy');
      assert.ok(csp, 'Content-Security-Policy must be configured');
      assert.ok(csp.includes("default-src 'self'"), 'CSP must include default-src');
      assert.ok(csp.includes("frame-ancestors 'none'"), 'CSP must include frame-ancestors none');
      assert.ok(csp.includes("object-src 'none'"), 'CSP must disable plugins via object-src none');
      assert.ok(csp.includes("base-uri 'self'"), 'CSP must restrict base-uri');
      assert.ok(csp.includes("form-action 'self'"), 'CSP must restrict form-action');

      // Cross-origin and defense headers
      assert.equal(headerMap.get('Cross-Origin-Opener-Policy'), 'same-origin');
      assert.equal(headerMap.get('Cross-Origin-Resource-Policy'), 'same-origin');
      assert.equal(headerMap.get('X-Permitted-Cross-Domain-Policies'), 'none');
    });
  });
});
