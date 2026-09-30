export const translations = {
  ru: {
    appTitle: 'Qaza Tracker',
    appSubtitle: 'Трекер намазов',
    qazaBalance: 'Остаток Каза',
    totalPrayers: 'намазов всего',
    fulfillOne: 'Восполнить 1',
    prayersToday: 'Намазы на сегодня',
    completed: 'Завершено',
    of: 'из',
    streak: 'дней подряд',
    testNewDay: 'Тест: Новый день',
    loadingDate: 'Загрузка даты...',
    nav: {
      home: 'Главная',
      calculator: 'Калькулятор',
      calendar: 'Календарь',
      history: 'История',
      settings: 'Настройки',
    },
    prayers: {
      fajr: 'Фаджр',
      dhuhr: 'Зухр',
      asr: 'Аср',
      maghrib: 'Магриб',
      isha: 'Иша',
    },
  },
  en: {
    appTitle: 'Qaza Tracker',
    appSubtitle: 'Prayer Tracker',
    qazaBalance: 'Qaza Balance',
    totalPrayers: 'total prayers',
    fulfillOne: 'Complete 1',
    prayersToday: "Today's Prayers",
    completed: 'Completed',
    of: 'of',
    streak: 'day streak',
    testNewDay: 'Test: New Day',
    loadingDate: 'Loading date...',
    nav: {
      home: 'Home',
      calculator: 'Calculator',
      calendar: 'Calendar',
      history: 'History',
      settings: 'Settings',
    },
    prayers: {
      fajr: 'Fajr',
      dhuhr: 'Dhuhr',
      asr: 'Asr',
      maghrib: 'Maghrib',
      isha: 'Isha',
    },
  },
  uz: {
    appTitle: 'Qaza Tracker',
    appSubtitle: 'Namaz trekeri',
    qazaBalance: 'Qazo qoldig‘i',
    totalPrayers: 'jami namozlar',
    fulfillOne: '1 ta ado etish',
    prayersToday: 'Bugungi namozlar',
    completed: 'Bajarildi',
    of: 'dan',
    streak: 'kun ketma-ket',
    testNewDay: 'Test: Yangi kun',
    loadingDate: 'Sana yuklanmoqda...',
    nav: {
      home: 'Bosh sahifa',
      calculator: 'Kalkulyator',
      calendar: 'Taqvim',
      history: 'Tarix',
      settings: 'Sozlamalar',
    },
    prayers: {
      fajr: 'Bomdod',
      dhuhr: 'Peshin',
      asr: 'Asr',
      maghrib: 'Shom',
      isha: 'Xufton',
    },
  },
} as const;

export type Language = 'ru' | 'en' | 'uz';

export type TranslationContent = {
  appTitle: string;
  appSubtitle: string;
  qazaBalance: string;
  totalPrayers: string;
  fulfillOne: string;
  prayersToday: string;
  completed: string;
  of: string;
  streak: string;
  testNewDay: string;
  loadingDate: string;
  nav: {
    home: string;
    calculator: string;
    calendar: string;
    history: string;
    settings: string;
  };
  prayers: {
    fajr: string;
    dhuhr: string;
    asr: string;
    maghrib: string;
    isha: string;
  };
};

export type TranslationKey = TranslationContent;
