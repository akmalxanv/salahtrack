export type Language = 'ru' | 'en' | 'uz';

export const ALLOWED_LANGUAGES = ['uz', 'ru', 'en'] as const;

export const STORAGE_KEY = 'namozlarim_lang';
export const FALLBACK_STORAGE_KEY = 'salahtrack_lang';

export function isValidLanguage(val: unknown): val is Language {
  return val === 'en' || val === 'ru' || val === 'uz';
}

/**
 * Normalizes and sanitizes untrusted language input.
 * Rejects prototype pollution attempts, directory traversal, null bytes,
 * and returns a safe allowlisted Language code.
 */
export function sanitizeLanguage(val: unknown, fallback: Language = 'uz'): Language {
  if (typeof val === 'string') {
    // Strip null bytes, control characters, and leading/trailing whitespace
    const clean = val.replace(/[\x00-\x1F\x7F]/g, '').trim().toLowerCase();
    if (isValidLanguage(clean)) {
      return clean;
    }
    // Safe sub-tag resolution (e.g. 'uz-UZ' -> 'uz', 'ru-RU' -> 'ru', 'en-US' -> 'en')
    const prefix = clean.split(/[-_]/)[0];
    if (isValidLanguage(prefix)) {
      return prefix;
    }
  }
  return isValidLanguage(fallback) ? fallback : 'uz';
}

/**
 * Safe string template interpolation for translation dictionaries.
 * Replaces placeholder tokens like {count}, {name}, {days} safely.
 *
 * Security Features:
 * - Strictly verifies own properties via Object.prototype.hasOwnProperty (blocks prototype property lookup)
 * - Defeats ReDoS using non-backtracking identifier token matching: /\{([a-zA-Z0-9_]+)\}/g
 * - Strips ASCII control characters from injected values
 * - Returns sanitized plain string, safe for React Virtual DOM rendering (no dangerouslySetInnerHTML)
 */
export function interpolate(
  template: string,
  params?: Record<string, string | number | boolean>,
  printfArg?: string | number
): string {
  if (typeof template !== 'string') return '';
  let result = template;
  if (params && typeof params === 'object') {
    result = result.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        const val = params[key];
        if (val === undefined || val === null) return '';
        return String(val).replace(/[\x00-\x1F\x7F]/g, '');
      }
      return match;
    });
  }
  if (printfArg !== undefined && printfArg !== null) {
    const cleanArg = String(printfArg).replace(/[\x00-\x1F\x7F]/g, '');
    result = result.replace(/%s/g, cleanArg);
  }
  return result;
}

/**
 * Strips ASCII control characters and null bytes from dynamic strings.
 */
export function safeString(val: unknown): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

export function getStoredLanguage(storage?: { getItem(key: string): string | null }): Language | null {
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return null;
  try {
    const primary = store.getItem(STORAGE_KEY);
    if (isValidLanguage(primary)) {
      return primary;
    }
    const fallback = store.getItem(FALLBACK_STORAGE_KEY);
    if (isValidLanguage(fallback)) {
      return fallback;
    }
  } catch {
    // ignore
  }
  return null;
}

export interface TranslationContent {
  appTitle: string;
  appSubtitle: string;
  common: {
    hoursUnit: string;
    minsUnit: string;
    currency: string;
    activeLocalProfile: string;
    loading: string;
    save: string;
    saved: string;
    cancel: string;
    error: string;
    success: string;
    or: string;
    retry: string;
  };
  nav: {
    home: string;
    progress: string;
    leaderboard: string;
    qibla: string;
    account: string;
    history: string;
    stats: string;
    profile: string;
    login: string;
    signup: string;
    logout: string;
  };
  auth: {
    login: {
      title: string;
      subtitle: string;
      identifierLabel: string;
      identifierPlaceholder: string;
      passwordLabel: string;
      passwordPlaceholder: string;
      rememberMe: string;
      submit: string;
      submitting: string;
      noAccount: string;
      signupLink: string;
      forgotPasswordLink: string;
      invalidCredentials: string;
      rateLimited: string;
      loginSuccess: string;
    };
    signup: {
      title: string;
      subtitle: string;
      nameLabel: string;
      namePlaceholder: string;
      usernameLabel: string;
      usernamePlaceholder: string;
      emailLabel: string;
      emailPlaceholder: string;
      passwordLabel: string;
      passwordPlaceholder: string;
      confirmPasswordLabel: string;
      confirmPasswordPlaceholder: string;
      termsPledge: string;
      submit: string;
      submitting: string;
      haveAccount: string;
      loginLink: string;
      signupSuccess: string;
      failed: string;
    };
    forgotPassword: {
      title: string;
      subtitle: string;
      emailLabel: string;
      emailPlaceholder: string;
      submit: string;
      submitting: string;
      backToLogin: string;
      infoNotice: string;
      successNotice: string;
      devTerminalNotice: string;
    };
    resetPassword: {
      title: string;
      subtitle: string;
      newPasswordLabel: string;
      newPasswordPlaceholder: string;
      confirmPasswordLabel: string;
      confirmPasswordPlaceholder: string;
      submit: string;
      submitting: string;
      successNotice: string;
      backToLogin: string;
      invalidToken: string;
      requestNewLinkHint: string;
    };
    validation: {
      passwordRequirements: string;
      passwordsMustMatch: string;
      requiredField: string;
      invalidEmail: string;
      invalidUsername: string;
    };
    logout: {
      button: string;
      loggingOut: string;
    };
    networkError: string;
    showPassword: string;
    hidePassword: string;
    passwordCriteriaLength: string;
    passwordCriteriaLetters: string;
    passwordCriteriaSpecial: string;
    footerTagline: string;
  };
  guest: {
    bannerTitle: string;
    bannerBadge: string;
    bannerDesc: string;
    loginButton: string;
    signupButton: string;
    continueAsGuest: string;
    modalTitle: string;
    modalDesc: string;
    modalConfirm: string;
    modalCancel: string;
  };
  sessionExpired: {
    title: string;
    desc: string;
    signInAgain: string;
    dismiss: string;
  };
  prayers: Record<'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha', string>;
  statuses: Record<'PENDING' | 'PRAYED_ON_TIME' | 'PRAYED_LATE' | 'MISSED' | 'MADE_UP' | 'PRAYED', string>;
  dashboard: {
    todayPrayers: string;
    completedRatio: string;
    streakDays: string;
    nextPrayer: string;
    in: string;
    timeNow: string;
    changeStatus: string;
    markPrayed: string;
    markPrayedOnTime: string;
    markPrayedLate: string;
    markMissed: string;
    markMadeUp: string;
    resetToPending: string;
    location: string;
    liveCalculation: string;
    dailyProgressTitle: string;
    completedCountOfTotal: string;
    madeUpDistinctNote: string;
    saving: string;
    saved: string;
    saveFailed: string;
    locationUnavailable: string;
    apiError: string;
    timesSource: string;
    tomorrowPrayer: string;
    overnightIshaActive: string;
    overnightIshaBadge: string;
    hijriBadge: string;
    statusLive: string;
    allCaughtUp: string;
    receiptDetails: string;
    hideReceiptDetails: string;
  };
  accountability: {
    title: string;
    disclaimer: string;
    qazaBalance: string;
    prayersCount: string;
    pledgeAmount: string;
    fulfillOne: string;
    addMissed: string;
    editCount: string;
    save: string;
    cancel: string;
    baseRateNote: string;
    overdueNote: string;
    payQaza: string;
    payModalTitle: string;
    payModalDesc: string;
    selectAll: string;
    deselectAll: string;
    noOutstanding: string;
    confirmPayment: string;
    confirming: string;
    selectedTotal: string;
    paymentSuccess: string;
    paymentError: string;
    unpaid: string;
    paid: string;
    paymentHistory: string;
    noPaymentsYet: string;
    receiptId: string;
    confirmedMadeUpCheckbox: string;
    confirmedMadeUpWarning: string;
    blockPaymentNotice: string;
    spiritualTitle: string;
    spiritualDesc: string;
    financialTitle: string;
    financialDesc: string;
    sadaqahNotice: string;
    qazaRuleNotice: string;
    overdueExplanation: string;
    overdueWhyReason: string;
    baseDebtLabel: string;
    overduePenaltyLabel: string;
    totalOutstandingLabel: string;
    remainingBalanceLabel: string;
    statusMissedNeedsMakeup: string;
    statusMadeUpSpiritualDone: string;
    markAsMadeUp: string;
    donateSadaqah: string;
    baseFinesSubtotal: string;
    overduePenaltiesSubtotal: string;
    spiritualPendingCount: string;
    totalFinancialDebt: string;
  };
  leaderboard: {
    title: string;
    subtitle: string;
    standings: string;
    daily: string;
    weekly: string;
    monthly: string;
    rank: string;
    worshipper: string;
    prayersCompleted: string;
    onTimeCount: string;
    streak: string;
    consistency: string;
    optInPrompt: string;
    optInNotice: string;
    optInButton: string;
    optOutButton: string;
    optInStatusOn: string;
    optInStatusOff: string;
    emptyLeaderboard: string;
    emptyLeaderboardDesc: string;
    youBadge: string;
    participantsCount: string;
    loadError: string;
  };
  profile: {
    title: string;
    subtitle: string;
    account: string;
    accountDesc: string;
    personalInfo: string;
    fullName: string;
    username: string;
    email: string;
    saveProfile: string;
    savingProfile: string;
    profileUpdated: string;
    languagePref: string;
    cityLocation?: string;
    cityLocationDesc?: string;
    detectGps?: string;
    detectingGps?: string;
    locationSaved?: string;
    uzbekistanCities?: string;
    internationalCities?: string;
    currentLocation?: string;
    changeLocation?: string;
    customCoordinates?: string;
    country?: string;
    coordinates?: string;
    timezone?: string;
    saveLocation?: string;
    savingLocation?: string;
    activeBadge?: string;
    gpsDenied?: string;
    gpsUnavailable?: string;
    gpsTimeout?: string;
    gpsGenericError?: string;
    discipline: string;
    disciplineDesc: string;
    basePledge: string;
    basePledgeDesc: string;
    gracePeriod: string;
    gracePeriodDesc: string;
    leaderboardPrivacy: string;
    leaderboardPrivacyDesc: string;
    changePassword: string;
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
    updatePassword: string;
    updatingPassword: string;
    passwordChanged: string;
    logoutButton: string;
  };
  history: {
    title: string;
    subtitle: string;
    dailyView: string;
    weeklyView: string;
    monthlyView: string;
    selectDate: string;
    noRecords: string;
    prayersCompleted: string;
    comingSoon?: string;
  };
  stats: {
    title: string;
    subtitle: string;
    todayCompletion: string;
    weeklyCompletion: string;
    monthlyCompletion: string;
    onTimeCount: string;
    lateCount: string;
    missedCount: string;
    madeUpCount: string;
    currentStreak: string;
    bestStreak: string;
    accountabilityAmount: string;
    consistencyScore: string;
    comingSoon?: string;
  };
  qibla: {
    title: string;
    subtitle: string;
    headingToKaaba: string;
    directionBearing: string;
    compassSensor: string;
    numericFallback: string;
    compassCalibrating: string;
    permissionDenied: string;
    distanceToKaaba: string;
    kmUnit: string;
    comingSoon?: string;
    turnLeft: string;
    turnRight: string;
    aligned: string;
    levelOptimal: string;
    slightTilt: string;
    excessiveTilt: string;
    calibrateTitle: string;
    calibrateDesc: string;
    calibrateFigure8: string;
    calibrateClose: string;
    calibrateButton: string;
    selectCity: string;
    searchCityPlaceholder: string;
    customCoords: string;
    latLabel: string;
    lngLabel: string;
    applyCoords: string;
    uzbekistanRegions: string;
    internationalCities: string;
    currentLocation: string;
    desktopSliderHint: string;
    manualSimulation: string;
    headingLabel: string;
    degreesUnit: string;
    detectedLocation: string;
    defaultLocation: string;
    enableSensor: string;
    requestPermissionHint: string;
    cardinalN: string;
    cardinalE: string;
    cardinalS: string;
    cardinalW: string;
    kaabaBeacon: string;
    accuracyOptimal: string;
    accuracyWarning: string;
    sensorNotSupported: string;
    noCitiesFound: string;
    invalidCoordinates: string;
    destinationKaaba: string;
    resetSensor: string;
    insecureContextWarning: string;
    compassQiblaLabel: string;
    accuracyOptimalTip: string;
    trueNorthGps: string;
    magneticDeclination: string;
    needsCalibration: string;
    figure8Alert: string;
  };
  settings: {
    title: string;
    subtitle: string;
    desc: string;
  };
  calculator: {
    title: string;
    subtitle: string;
    desc: string;
  };
  qaza: {
    title: string;
    subtitle: string;
    desc: string;
  };
  analytics: {
    title: string;
    subtitle: string;
    desc: string;
  };
  calendar: {
    title: string;
    subtitle: string;
    desc: string;
    prevMonth: string;
    nextMonth: string;
    today: string;
    jumpToToday: string;
    weekdaysShort: [string, string, string, string, string, string, string];
    months: [
      string, string, string, string, string, string,
      string, string, string, string, string, string
    ];
    selectedDateTitle: string;
    dayCompletion: string;
    editDayPrayers: string;
    futureDateDisabled: string;
    preStartNotice: string;
    preStartBadge: string;
    resetDay: string;
    resetDayConfirm: string;
    legend: {
      title: string;
      perfect: string;
      prayed?: string;
      partial?: string;
      missed: string;
      madeUp?: string;
      pending: string;
    };
    summary: {
      prayersCompleted: string;
      onTimeRate: string;
    };
    hijri: {
      title: string;
      subtitle: string;
      sightingAdjustment: string;
      adjustmentTooltip: string;
      standard: string;
      minusDay: string;
      plusDay: string;
      today: string;
      jumpToCurrentMonth: string;
      selectedDate: string;
      era: string;
      arabicEra: string;
      gregorianSubtext: string;
      months: [
        string, string, string, string, string, string,
        string, string, string, string, string, string
      ];
      arabicMonths: [
        string, string, string, string, string, string,
        string, string, string, string, string, string
      ];
    };
  };
  groups: {
    title: string;
    subtitle: string;
    createGroup: string;
    joinGroup: string;
    inviteCode: string;
    enterInviteCode: string;
    groupName: string;
    groupNamePlaceholder: string;
    description: string;
    membersCount: string;
    leaveGroup: string;
    deleteGroup: string;
    copyCode: string;
    codeCopied: string;
    noGroups: string;
    owner: string;
    member: string;
    tabGlobal: string;
    tabGroups: string;
    viewCircle: string;
    descriptionPlaceholder: string;
    confirmLeave: string;
    confirmLeaveTitle: string;
    confirmDeleteTitle: string;
    confirmDeleteDesc: string;
    confirmDeleteButton: string;
    confirmLeaveButton: string;
    deleting: string;
    leaving: string;
    failedDelete: string;
    backToCircles: string;
    failedCreate: string;
    failedJoin: string;
    networkError: string;
    viewMemberHistory?: string;
    memberHistoryTitle?: string;
    readOnlyNotice?: string;
    yourProfile: string;
    yourHistoryInProgress: string;
    strictlyReadOnly: string;
    backToMemberList: string;
    loadError: string;
    loadDetailsError: string;
    memberHistoryLoadError: string;
    circleUnavailable: string;
  };
  progress: {
    title: string;
    subtitle: string;
    signInPrompt: string;
    tabs: {
      overview: string;
      history: string;
      analytics: string;
      qaza: string;
    };
    summary: {
      completionRate: string;
      onTimeRate: string;
      missedPrayers: string;
      madeUpPrayers: string;
      currentStreak: string;
      bestStreak: string;
      totalLogged: string;
      qazaBalance: string;
    };
    periods: {
      d7: string;
      d30: string;
      custom: string;
    };
    insights: {
      title: string;
      mostConsistent: string;
      needsAttention: string;
      streakEncouragement: string;
      qazaGoal: string;
    };
    prayersCompletedRecord: string;
    consistencyTitle: string;
    consistencySubtitle: string;
    calculatorTitle: string;
    dailyOneExtra: string;
    dailyFiveExtra: string;
    daysToComplete: string;
    onePerDayShort: string;
    fivePerDayShort: string;
    daysShort: string;
    historicalEditNotice: string;
    editRecord: string;
    doneEditing: string;
    futureDateError: string;
    accountabilityBreakdown: string;
    baseFine: string;
    overdueFine: string;
    daysOverdue: string;
    noFines: string;
    settledAmount: string;
    recordPayment: string;
    recordPaymentDesc: string;
    indicator30d: string;
    detailedBreakdown: string;
    recentHistoryTitle: string;
    viewAll: string;
    todayBadge: string;
    missedPrayersCount: string;
    overduePrayersCount: string;
    finesPolicyNotice: string;
    settlementPlaceholder: string;
    overdueBadge: string;
    baseFineLabel: string;
    overdueFineLabel: string;
    showAllCount: string;
    showLess: string;
  };
  account: {
    title: string;
    subtitle: string;
    signInTitle: string;
    signInSubtitle: string;
    languageSubtitle: string;
    argonSecurityNote: string;
    showPassword: string;
    hidePassword: string;
    secureSessionTitle: string;
    secureSessionDesc: string;
    contactPrompt: string;
    contactLink: string;
    defaultCountry: string;
    tabs: {
      profile: string;
      preferences: string;
      privacy: string;
      security: string;
    };
    sections: {
      personalInfo: string;
      personalInfoDesc: string;
      preferences: string;
      privacy: string;
      privacyDesc: string;
      security: string;
      securityDesc: string;
    };
    passwordStrength: string;
    passwordWeak: string;
    passwordMedium: string;
    passwordStrong: string;
    telegram: {
      title: string;
      description: string;
      consent: string;
      connect: string;
      openBot: string;
      linkExpires: string;
      linkedAs: string;
      unlink: string;
      checkStatus: string;
      notConfigured: string;
      error: string;
      groupHint: string;
    };
  };
  apiErrors: {
    AUTH_UNAUTHORIZED: string;
    AUTH_FORBIDDEN: string;
    AUTH_SESSION_EXPIRED: string;
    AUTH_INVALID_CREDENTIALS: string;
    AUTH_RATE_LIMITED: string;
    AUTH_INVALID_TOKEN: string;
    VALIDATION_FAILED: string;
    DUPLICATE_EMAIL: string;
    DUPLICATE_USERNAME: string;
    USER_NOT_FOUND: string;
    INVALID_CURRENT_PASSWORD: string;
    PASSWORDS_DO_NOT_MATCH: string;
    PASSWORD_TOO_WEAK: string;
    INVALID_LANGUAGE: string;
    INVALID_DATE: string;
    FUTURE_DATE_NOT_ALLOWED: string;
    INVALID_PRAYER_ID: string;
    INVALID_PRAYER_STATUS: string;
    CIRCLE_NOT_FOUND: string;
    CIRCLE_ALREADY_MEMBER: string;
    CIRCLE_NOT_MEMBER: string;
    INVALID_INVITE_CODE: string;
    INTERNAL_SERVER_ERROR: string;
    RESOURCE_NOT_FOUND: string;
  };
}

export type TranslationKey = TranslationContent;

/**
 * Resolves a machine-readable error code or fallback error message to a localized string
 */
export function getLocalizedApiError(codeOrMessage: string | undefined, t: TranslationContent): string {
  if (!codeOrMessage) return t.common.error;
  if (codeOrMessage in t.apiErrors) {
    return t.apiErrors[codeOrMessage as keyof typeof t.apiErrors];
  }
  return codeOrMessage;
}
