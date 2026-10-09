export type Language = 'ru' | 'en' | 'uz';

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
    dailyProgressTitle: string;
    completedCountOfTotal: string;
    madeUpDistinctNote: string;
    saving: string;
    saved: string;
    saveFailed: string;
    notifications: string;
    notificationsEnabled: string;
    notificationsBlocked: string;
    enableNotifications: string;
    locationUnavailable: string;
    apiError: string;
    calcMethod: string;
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
  };
  leaderboard: {
    title: string;
    subtitle: string;
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
    youBadge: string;
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
    calcMethod: string;
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
    copyCode: string;
    codeCopied: string;
    noGroups: string;
    owner: string;
    member: string;
    tabGlobal: string;
    tabGroups: string;
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
      preferencesDesc: string;
      privacy: string;
      privacyDesc: string;
      security: string;
      securityDesc: string;
    };
  };
}

export const translations: Record<Language, TranslationContent> = {
  ru: {
    appTitle: 'SalahTrack',
    appSubtitle: 'Трекер намаза и самоконтроля',
    common: {
      hoursUnit: 'ч',
      minsUnit: 'мин',
      currency: 'UZS',
      activeLocalProfile: 'Активный профиль',
      loading: 'Загрузка...',
      save: 'Сохранить',
      saved: 'Сохранено',
      cancel: 'Отмена',
      error: 'Произошла ошибка',
      success: 'Успешно',
    },
    nav: {
      home: 'Главная',
      progress: 'Прогресс',
      leaderboard: 'Рейтинг',
      qibla: 'Кибла',
      account: 'Аккаунт',
      history: 'История',
      stats: 'Статистика',
      profile: 'Профиль',
      login: 'Войти',
      signup: 'Регистрация',
      logout: 'Выйти',
    },
    auth: {
      login: {
        title: 'Вход в аккаунт',
        subtitle: 'Войдите, чтобы продолжить отслеживание намазов и синхронизацию',
        identifierLabel: 'Email или имя пользователя',
        identifierPlaceholder: 'name@example.com или username',
        passwordLabel: 'Пароль',
        passwordPlaceholder: 'Введите ваш пароль',
        rememberMe: 'Запомнить меня на 30 дней',
        submit: 'Войти',
        submitting: 'Вход...',
        noAccount: 'Нет аккаунта?',
        signupLink: 'Зарегистрироваться',
        forgotPasswordLink: 'Забыли пароль?',
        invalidCredentials: 'Неверный email/имя пользователя или пароль',
        rateLimited: 'Слишком много попыток. Пожалуйста, подождите 15 минут.',
        loginSuccess: 'Успешный вход в систему',
      },
      signup: {
        title: 'Создать аккаунт',
        subtitle: 'Начните вести осознанный учет намазов и личной дисциплины',
        nameLabel: 'Полное имя',
        namePlaceholder: 'Ахмад Алиев',
        usernameLabel: 'Имя пользователя',
        usernamePlaceholder: 'ahmad_aliyev',
        emailLabel: 'Электронная почта',
        emailPlaceholder: 'ahmad@example.com',
        passwordLabel: 'Пароль',
        passwordPlaceholder: 'Минимум 8 символов (заглавная, строчная, цифра, знак)',
        confirmPasswordLabel: 'Подтвердите пароль',
        confirmPasswordPlaceholder: 'Повторите пароль',
        termsPledge: 'Я принимаю обязательство личной ответственности и самодисциплины',
        submit: 'Создать аккаунт',
        submitting: 'Создание аккаунта...',
        haveAccount: 'Уже есть аккаунт?',
        loginLink: 'Войти',
        signupSuccess: 'Аккаунт успешно создан!',
      },
      forgotPassword: {
        title: 'Восстановление пароля',
        subtitle: 'Введите ваш email для получения инструкций по сбросу пароля',
        emailLabel: 'Электронная почта',
        emailPlaceholder: 'name@example.com',
        submit: 'Отправить ссылку для сброса',
        submitting: 'Отправка...',
        backToLogin: 'Вернуться ко входу',
        infoNotice: 'На ваш email будет отправлена одноразовая ссылка, действующая 15 минут.',
        successNotice: 'Если аккаунт с этим email существует, инструкция по сбросу отправлена.',
      },
      resetPassword: {
        title: 'Установка нового пароля',
        subtitle: 'Придумайте надежный пароль для вашей учетной записи',
        newPasswordLabel: 'Новый пароль',
        newPasswordPlaceholder: 'Минимум 8 символов с цифрами и спецсимволами',
        confirmPasswordLabel: 'Подтвердите новый пароль',
        confirmPasswordPlaceholder: 'Повторите новый пароль',
        submit: 'Обновить пароль',
        submitting: 'Обновление...',
        successNotice: 'Пароль успешно обновлен. Теперь вы можете войти с новыми данными.',
        backToLogin: 'Перейти ко входу',
        invalidToken: 'Недействительная или устаревшая ссылка для сброса пароля.',
      },
      validation: {
        passwordRequirements: 'Пароль должен содержать не менее 8 символов, включая заглавную и строчную буквы, цифру и спецсимвол.',
        passwordsMustMatch: 'Пароли не совпадают',
        requiredField: 'Это поле обязательно для заполнения',
        invalidEmail: 'Введите корректный адрес электронной почты',
        invalidUsername: 'Имя пользователя должно состоять из 3-30 символов (буквы, цифры, подчеркивания)',
      },
      logout: {
        button: 'Выйти из аккаунта',
        loggingOut: 'Выход...',
      },
    },
    prayers: {
      fajr: 'Фаджр',
      dhuhr: 'Зухр',
      asr: 'Аср',
      maghrib: 'Магриб',
      isha: 'Иша',
    },
    statuses: {
      PENDING: 'В ожидании',
      PRAYED: 'Прочитан',
      PRAYED_ON_TIME: 'Вовремя',
      PRAYED_LATE: 'С опозданием',
      MISSED: 'Каза',
      MADE_UP: 'Восполнен',
    },
    dashboard: {
      todayPrayers: 'Намазы на сегодня',
      completedRatio: 'Выполнено',
      streakDays: 'дней подряд',
      nextPrayer: 'Следующий намаз',
      in: 'через',
      timeNow: 'Текущее время',
      changeStatus: 'Изменить статус',
      markPrayed: 'Прочитан',
      markPrayedOnTime: 'Прочитан вовремя',
      markPrayedLate: 'Прочитан позже',
      markMissed: 'Каза (пропущен)',
      markMadeUp: 'Восполнен (Каза)',
      resetToPending: 'Сбросить в ожидание',
      location: 'Ташкент',
      dailyProgressTitle: 'Дневной прогресс',
      completedCountOfTotal: 'из 5 выполнено',
      madeUpDistinctNote: 'Восполненные каза не засчитываются в исходный день',
      saving: 'Сохранение...',
      saved: 'Сохранено',
      saveFailed: 'Ошибка сохранения',
      notifications: 'Напоминания',
      notificationsEnabled: 'Напоминания включены',
      notificationsBlocked: 'Напоминания заблокированы в браузере',
      enableNotifications: 'Включить напоминания',
      locationUnavailable: 'Геолокация недоступна',
      apiError: 'Ошибка загрузки расписания',
      calcMethod: 'Метод расчёта',
    },
    accountability: {
      title: 'Учёт Каза и обязательств',
      disclaimer: 'Внимание: Данный механизм учета является личным инструментом самодисциплины и ответственности, а не религиозной фетвой или шариатским постановлением.',
      qazaBalance: 'Остаток Каза',
      prayersCount: 'намазов',
      pledgeAmount: 'Сумма обязательства',
      fulfillOne: 'Восполнить каза (-1)',
      addMissed: 'Добавить каза (+1)',
      editCount: 'Изменить число',
      save: 'Сохранить',
      cancel: 'Отмена',
      baseRateNote: 'Базовая ставка: 15 000 UZS за пропущенный намаз',
      overdueNote: 'Период восполнения: 7 дней, далее +15 000 UZS за просрочку',
    },
    leaderboard: {
      title: 'Рейтинг постоянства',
      subtitle: 'Анонимная мотивационная таблица среди пользователей, согласившихся на участие',
      daily: 'За день',
      weekly: 'За неделю',
      monthly: 'За месяц',
      rank: 'Место',
      worshipper: 'Участник',
      prayersCompleted: 'Выполнено',
      onTimeCount: 'Вовремя',
      streak: 'Серия',
      consistency: 'Постоянство',
      optInPrompt: 'Участие в рейтинге',
      optInNotice: 'Ваш профиль скрыт из рейтинга по умолчанию. Включите отображение, чтобы участвовать в мотивационной таблице.',
      optInButton: 'Участвовать в рейтинге',
      optOutButton: 'Скрыть меня из рейтинга',
      optInStatusOn: 'Вы участвуете в рейтинге',
      optInStatusOff: 'Вы скрыты из рейтинга',
      emptyLeaderboard: 'В выбранном периоде пока нет данных участников.',
      youBadge: 'Вы',
    },
    profile: {
      title: 'Профиль',
      subtitle: 'Личные данные, настройки аккаунта и самоконтроля',
      account: 'Учетная запись',
      accountDesc: 'Авторизованный пользователь SalahTrack',
      personalInfo: 'Персональная информация',
      fullName: 'Полное имя',
      username: 'Имя пользователя',
      email: 'Email',
      saveProfile: 'Сохранить профиль',
      savingProfile: 'Сохранение...',
      profileUpdated: 'Профиль успешно обновлен',
      languagePref: 'Язык интерфейса',
      calcMethod: 'Метод расчета времени намазов',
      discipline: 'Система обязательств',
      disciplineDesc: 'Параметры личной ответственности за пропущенные намазы.',
      basePledge: 'Базовая ставка обязательства',
      basePledgeDesc: '15 000 UZS за пропущенный намаз',
      gracePeriod: 'Период восполнения',
      gracePeriodDesc: '7 дней до начисления дополнительного штрафа',
      leaderboardPrivacy: 'Отображение в общем рейтинге',
      leaderboardPrivacyDesc: 'Показывать ли вашу статистику выполненных намазов в публичном рейтинге',
      changePassword: 'Смена пароля',
      currentPassword: 'Текущий пароль',
      newPassword: 'Новый пароль',
      confirmNewPassword: 'Подтвердите новый пароль',
      updatePassword: 'Обновить пароль',
      updatingPassword: 'Обновление пароля...',
      passwordChanged: 'Пароль успешно изменен',
      logoutButton: 'Выйти из системы',
    },
    history: {
      title: 'История намазов',
      subtitle: 'Журнал совершенных и восполненных намазов за выбранный период',
      dailyView: 'День',
      weeklyView: 'Неделя',
      monthlyView: 'Месяц',
      selectDate: 'Выбрать дату',
      noRecords: 'За выбранный период записей не найдено',
      prayersCompleted: 'Совершено намазов',
      comingSoon: 'Модуль истории намазов находится в разработке.',
    },
    stats: {
      title: 'Статистика и аналитика',
      subtitle: 'Точные метрики постоянства и выполнения ежедневных обязательств',
      todayCompletion: 'Сегодня',
      weeklyCompletion: 'За 7 дней',
      monthlyCompletion: 'За 30 дней',
      onTimeCount: 'Вовремя',
      lateCount: 'С опозданием',
      missedCount: 'Каза',
      madeUpCount: 'Восполнено',
      currentStreak: 'Текущая серия',
      bestStreak: 'Лучшая серия',
      accountabilityAmount: 'Сумма обязательств',
      consistencyScore: 'Общий процент постоянства',
      comingSoon: 'Модуль статистики и аналитики находится в разработке.',
    },
    qibla: {
      title: 'Кибла',
      subtitle: 'Точный расчет направления на Каабу (21.4225° N, 39.8262° E)',
      headingToKaaba: 'Направление на Каабу',
      directionBearing: 'Азимут',
      compassSensor: 'Датчик компаса активен',
      numericFallback: 'Отображение азимута по координатам',
      compassCalibrating: 'Калибровка датчика направления...',
      permissionDenied: 'Доступ к геолокации отклонен. Используются координаты Ташкента по умолчанию.',
      distanceToKaaba: 'Расстояние до Каабы',
      kmUnit: 'км',
      comingSoon: 'Модуль направления Киблы находится в разработке.',
    },
    settings: {
      title: 'Настройки',
      subtitle: 'Управление параметрами приложения',
      desc: 'Параметры и предпочтения.',
    },
    calculator: {
      title: 'Калькулятор каза',
      subtitle: 'Расчет пропущенных намазов за прошлые периоды',
      desc: 'Форма ввода данных для расчета каза.',
    },
    qaza: {
      title: 'Журнал каза',
      subtitle: 'Учет и восполнение пропущенных обязательств',
      desc: 'Раздел управления каза.',
    },
    analytics: {
      title: 'Аналитика',
      subtitle: 'Графики и тренды выполнения',
      desc: 'Визуализация данных.',
    },
    calendar: {
      title: 'Календарь',
      subtitle: 'Сетка намазов по месяцам',
      desc: 'Календарный вид.',
    },
    groups: {
      title: 'Группы подотчетности',
      subtitle: 'Отслеживайте намазы вместе с близкими в приватных кругах',
      createGroup: 'Создать круг',
      joinGroup: 'Вступить по коду',
      inviteCode: 'Код приглашения',
      enterInviteCode: 'Введите код приглашения (например, ABCD-1234)',
      groupName: 'Название круга',
      groupNamePlaceholder: 'например, Семья или Друзья',
      description: 'Описание (необязательно)',
      membersCount: 'участников',
      leaveGroup: 'Покинуть круг',
      copyCode: 'Скопировать код',
      codeCopied: 'Код скопирован!',
      noGroups: 'Вы еще не состоите ни в одной группе. Создайте новый круг или присоединитесь по коду!',
      owner: 'Организатор',
      member: 'Участник',
      tabGlobal: 'Общий рейтинг',
      tabGroups: 'Мои группы',
    },
    progress: {
      title: 'Личный прогресс',
      subtitle: 'История намазов, показатели постоянства и каза',
      signInPrompt: 'Войдите, чтобы открыть облачную историю, долгосрочную аналитику и автоматический учет серий молитв.',
      tabs: {
        overview: 'Обзор',
        history: 'История и календарь',
        analytics: 'Аналитика',
        qaza: 'Каза и долги',
      },
      summary: {
        completionRate: 'Выполнение',
        onTimeRate: 'Вовремя',
        missedPrayers: 'Пропущено',
        madeUpPrayers: 'Восполнено',
        currentStreak: 'Текущая серия',
        bestStreak: 'Лучшая серия',
        totalLogged: 'Всего отмечено',
        qazaBalance: 'Баланс каза',
      },
      periods: {
        d7: '7 дней',
        d30: '30 дней',
        custom: 'Период',
      },
      insights: {
        title: 'Аналитические выводы',
        mostConsistent: 'Самый стабильный намаз',
        needsAttention: 'Требует внимания',
        streakEncouragement: 'Отличный темп! Продолжайте совершать намазы вовремя.',
        qazaGoal: 'Цель по закрытию каза',
      },
      prayersCompletedRecord: 'намазов совершено',
      consistencyTitle: 'Регулярность по намазам',
      consistencySubtitle: 'Доля своевременного совершения каждого намаза',
      calculatorTitle: 'Калькулятор восполнения каза-намазов',
      dailyOneExtra: 'Если восполнять по 1 намазу в день',
      dailyFiveExtra: 'Если восполнять по 1 дню (5 намазов) в день',
      daysToComplete: 'дней до полного восполнения',
      historicalEditNotice: 'Вы можете корректировать прошлые записи. Будущие даты заблокированы.',
      editRecord: 'Редактировать запись',
      doneEditing: 'Готово',
      futureDateError: 'Нельзя отмечать намазы на будущие даты',
      accountabilityBreakdown: 'Детализация подотчётности и обязательств',
      baseFine: 'Базовый взнос дисциплины (15 000 UZS за пропуск)',
      overdueFine: 'Штраф за просрочку свыше 7 дней (+15 000 UZS)',
      daysOverdue: 'дней с даты намаза',
      noFines: 'Нет начисленных взносов или долгов',
      settledAmount: 'Зафиксированная сумма взносов',
      recordPayment: 'Зафиксировать погашение / садака',
      recordPaymentDesc: 'Это инструмент личной дисциплины и самоконтроля, а не религиозное предписание.',
    },
    account: {
      title: 'Аккаунт и настройки',
      subtitle: 'Управление профилем, параметрами расчета и безопасностью',
      signInTitle: 'Войдите в свой облачный аккаунт',
      signInSubtitle: 'Войдите или зарегистрируйтесь, чтобы настроить индивидуальные методы расчета, вступить в круги подотчетности и защитить дневник молитв.',
      languageSubtitle: 'Язык интерфейса приложения',
      argonSecurityNote: 'Пароль надежно защищен алгоритмом Argon2id',
      showPassword: 'Показать пароли',
      hidePassword: 'Скрыть пароли',
      secureSessionTitle: 'Защищенная серверная сессия',
      secureSessionDesc: 'Ваша сессия хранится в защищенной базе данных на сервере (MongoDB) и защищена файлом cookie HttpOnly, SameSite=Lax. При закрытии браузера или выходе из системы сессия немедленно аннулируется сервером.',
      tabs: {
        profile: 'Профиль',
        preferences: 'Настройки',
        privacy: 'Приватность',
        security: 'Безопасность',
      },
      sections: {
        personalInfo: 'Личная информация',
        personalInfoDesc: 'Ваше имя и идентификационные данные в SalahTrack',
        preferences: 'Параметры и расчет',
        preferencesDesc: 'Язык приложения и богословский метод расчета времени намаза',
        privacy: 'Приватность и участие в сообществе',
        privacyDesc: 'Видимость в общем рейтинге и круги совместной ответственности',
        security: 'Безопасность и сессии',
        securityDesc: 'Смена пароля и управление защищенной серверной сессией',
      },
    },
  },

  en: {
    appTitle: 'SalahTrack',
    appSubtitle: 'Prayer Tracker & Personal Accountability',
    common: {
      hoursUnit: 'h',
      minsUnit: 'm',
      currency: 'UZS',
      activeLocalProfile: 'Active Profile',
      loading: 'Loading...',
      save: 'Save',
      saved: 'Saved',
      cancel: 'Cancel',
      error: 'An error occurred',
      success: 'Success',
    },
    nav: {
      home: 'Home',
      progress: 'Progress',
      leaderboard: 'Leaderboard',
      qibla: 'Qibla',
      account: 'Account',
      history: 'History',
      stats: 'Stats',
      profile: 'Profile',
      login: 'Login',
      signup: 'Sign Up',
      logout: 'Logout',
    },
    auth: {
      login: {
        title: 'Sign In',
        subtitle: 'Sign in to access your synchronized prayer journal and personal stats',
        identifierLabel: 'Email or Username',
        identifierPlaceholder: 'name@example.com or username',
        passwordLabel: 'Password',
        passwordPlaceholder: 'Enter your password',
        rememberMe: 'Remember me for 30 days',
        submit: 'Sign In',
        submitting: 'Signing in...',
        noAccount: "Don't have an account?",
        signupLink: 'Create one',
        forgotPasswordLink: 'Forgot password?',
        invalidCredentials: 'Invalid email/username or password',
        rateLimited: 'Too many attempts. Please try again after 15 minutes.',
        loginSuccess: 'Successfully signed in',
      },
      signup: {
        title: 'Create Account',
        subtitle: 'Begin your journey of mindful prayer tracking and disciplined accountability',
        nameLabel: 'Full Name',
        namePlaceholder: 'Ahmad Aliyev',
        usernameLabel: 'Username',
        usernamePlaceholder: 'ahmad_aliyev',
        emailLabel: 'Email Address',
        emailPlaceholder: 'ahmad@example.com',
        passwordLabel: 'Password',
        passwordPlaceholder: 'At least 8 characters (uppercase, lowercase, number, symbol)',
        confirmPasswordLabel: 'Confirm Password',
        confirmPasswordPlaceholder: 'Re-enter your password',
        termsPledge: 'I acknowledge this personal discipline and self-accountability pledge',
        submit: 'Create Account',
        submitting: 'Creating account...',
        haveAccount: 'Already have an account?',
        loginLink: 'Sign In',
        signupSuccess: 'Account created successfully!',
      },
      forgotPassword: {
        title: 'Reset Password',
        subtitle: 'Enter your account email to receive a secure recovery link',
        emailLabel: 'Email Address',
        emailPlaceholder: 'name@example.com',
        submit: 'Send Reset Link',
        submitting: 'Sending...',
        backToLogin: 'Back to Sign In',
        infoNotice: 'A single-use reset link valid for 15 minutes will be dispatched.',
        successNotice: 'If an account with that email exists, reset instructions have been sent.',
      },
      resetPassword: {
        title: 'Set New Password',
        subtitle: 'Choose a strong, unique password for your account',
        newPasswordLabel: 'New Password',
        newPasswordPlaceholder: 'Minimum 8 characters with mixed casing, digits & symbols',
        confirmPasswordLabel: 'Confirm New Password',
        confirmPasswordPlaceholder: 'Re-enter your new password',
        submit: 'Update Password',
        submitting: 'Updating...',
        successNotice: 'Password updated successfully. Please sign in with your new password.',
        backToLogin: 'Go to Sign In',
        invalidToken: 'Invalid or expired password reset link.',
      },
      validation: {
        passwordRequirements: 'Password must be at least 8 characters with lowercase, uppercase, number, and special character.',
        passwordsMustMatch: 'Passwords do not match',
        requiredField: 'This field is required',
        invalidEmail: 'Please enter a valid email address',
        invalidUsername: 'Username must be 3-30 characters with letters, numbers, and underscores only',
      },
      logout: {
        button: 'Sign Out',
        loggingOut: 'Signing out...',
      },
    },
    prayers: {
      fajr: 'Fajr',
      dhuhr: 'Dhuhr',
      asr: 'Asr',
      maghrib: 'Maghrib',
      isha: 'Isha',
    },
    statuses: {
      PENDING: 'Pending',
      PRAYED: 'Prayed',
      PRAYED_ON_TIME: 'On Time',
      PRAYED_LATE: 'Late',
      MISSED: 'Missed',
      MADE_UP: 'Made Up',
    },
    dashboard: {
      todayPrayers: "Today's Prayers",
      completedRatio: 'Completed',
      streakDays: 'day streak',
      nextPrayer: 'Next Prayer',
      in: 'in',
      timeNow: 'Current Time',
      changeStatus: 'Change Status',
      markPrayed: 'Prayed',
      markPrayedOnTime: 'Prayed on Time',
      markPrayedLate: 'Prayed Late',
      markMissed: 'Missed (Qaza)',
      markMadeUp: 'Made Up (Qaza)',
      resetToPending: 'Reset to Pending',
      location: 'Tashkent',
      dailyProgressTitle: 'Daily Progress',
      completedCountOfTotal: 'of 5 completed',
      madeUpDistinctNote: 'Made-up prayers do not count towards original day completion',
      saving: 'Saving...',
      saved: 'Saved',
      saveFailed: 'Save failed',
      notifications: 'Reminders',
      notificationsEnabled: 'Reminders enabled',
      notificationsBlocked: 'Reminders blocked by browser',
      enableNotifications: 'Enable reminders',
      locationUnavailable: 'Location unavailable',
      apiError: 'Schedule update error',
      calcMethod: 'Calculation Method',
    },
    accountability: {
      title: 'Qaza & Accountability Tracker',
      disclaimer: 'Notice: This accountability system is strictly a personal self-discipline mechanism, not a religious fatwa or sharia ruling.',
      qazaBalance: 'Qaza Balance',
      prayersCount: 'prayers',
      pledgeAmount: 'Discipline Fine',
      fulfillOne: 'Fulfill Qaza (-1)',
      addMissed: 'Add Qaza (+1)',
      editCount: 'Edit count',
      save: 'Save',
      cancel: 'Cancel',
      baseRateNote: 'Base pledge: 15,000 UZS per missed prayer',
      overdueNote: '7-day grace period, then +15,000 UZS overdue penalty',
    },
    leaderboard: {
      title: 'Consistency Leaderboard',
      subtitle: 'Optional motivational leaderboard for opted-in worshippers',
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
      rank: 'Rank',
      worshipper: 'Worshipper',
      prayersCompleted: 'Completed',
      onTimeCount: 'On Time',
      streak: 'Streak',
      consistency: 'Consistency',
      optInPrompt: 'Leaderboard Visibility',
      optInNotice: 'Your profile is private by default. Opt in to appear on the motivational leaderboard.',
      optInButton: 'Join Leaderboard',
      optOutButton: 'Hide from Leaderboard',
      optInStatusOn: 'You are visible on the leaderboard',
      optInStatusOff: 'You are hidden from the leaderboard',
      emptyLeaderboard: 'No worshipper entries for the selected time period.',
      youBadge: 'You',
    },
    profile: {
      title: 'Profile',
      subtitle: 'Account details, prayer preferences, and self-discipline settings',
      account: 'Account Status',
      accountDesc: 'Authenticated SalahTrack User',
      personalInfo: 'Personal Information',
      fullName: 'Full Name',
      username: 'Username',
      email: 'Email',
      saveProfile: 'Save Profile',
      savingProfile: 'Saving...',
      profileUpdated: 'Profile updated successfully',
      languagePref: 'Interface Language',
      calcMethod: 'Prayer Calculation Method',
      discipline: 'Accountability System',
      disciplineDesc: 'Personal discipline parameters for missed prayer pledges.',
      basePledge: 'Base Pledge Rate',
      basePledgeDesc: '15,000 UZS per missed prayer',
      gracePeriod: 'Grace Period',
      gracePeriodDesc: '7 days before additional overdue fine',
      leaderboardPrivacy: 'Public Leaderboard Participation',
      leaderboardPrivacyDesc: 'Allow your completed prayer stats to appear on the public community leaderboard',
      changePassword: 'Change Password',
      currentPassword: 'Current Password',
      newPassword: 'New Password',
      confirmNewPassword: 'Confirm New Password',
      updatePassword: 'Update Password',
      updatingPassword: 'Updating...',
      passwordChanged: 'Password changed successfully',
      logoutButton: 'Sign Out',
    },
    history: {
      title: 'Prayer History',
      subtitle: 'Interactive ledger of your daily, weekly, and monthly prayers',
      dailyView: 'Daily',
      weeklyView: 'Weekly',
      monthlyView: 'Monthly',
      selectDate: 'Select Date',
      noRecords: 'No prayer records found for this period',
      prayersCompleted: 'Prayers Completed',
      comingSoon: 'Prayer history module under active development.',
    },
    stats: {
      title: 'Statistics & Analytics',
      subtitle: 'Accurate metrics on your prayer timeliness, streaks, and discipline',
      todayCompletion: 'Today',
      weeklyCompletion: '7 Days',
      monthlyCompletion: '30 Days',
      onTimeCount: 'On Time',
      lateCount: 'Late',
      missedCount: 'Missed',
      madeUpCount: 'Made Up',
      currentStreak: 'Current Streak',
      bestStreak: 'Best Streak',
      accountabilityAmount: 'Accountability Balance',
      consistencyScore: 'Overall Consistency',
      comingSoon: 'Statistics module under active development.',
    },
    qibla: {
      title: 'Qibla Direction',
      subtitle: 'Great-circle bearing to the Holy Kaaba (21.4225° N, 39.8262° E)',
      headingToKaaba: 'Bearing to Kaaba',
      directionBearing: 'Compass Bearing',
      compassSensor: 'Device compass sensor active',
      numericFallback: 'Coordinate-derived bearing fallback',
      compassCalibrating: 'Calibrating direction sensor...',
      permissionDenied: 'Geolocation access denied. Using Tashkent default coordinates.',
      distanceToKaaba: 'Distance to Kaaba',
      kmUnit: 'km',
      comingSoon: 'Qibla direction module under active development.',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Manage preferences and app configuration',
      desc: 'Account preferences and settings.',
    },
    calculator: {
      title: 'Qaza Calculator',
      subtitle: 'Calculate missed prayers over past years and months',
      desc: 'Input form for calculating qaza debts.',
    },
    qaza: {
      title: 'Qaza Ledger',
      subtitle: 'Track fulfilled and remaining missed prayers',
      desc: 'Qaza ledger management.',
    },
    analytics: {
      title: 'Analytics',
      subtitle: 'Consistency charts and trends',
      desc: 'Analytical views.',
    },
    calendar: {
      title: 'Calendar',
      subtitle: 'Monthly prayer grid and status logs',
      desc: 'Calendar schedule.',
    },
    groups: {
      title: 'Accountability Circles',
      subtitle: 'Track prayers together with friends and family in private circles',
      createGroup: 'Create Circle',
      joinGroup: 'Join with Code',
      inviteCode: 'Invite Code',
      enterInviteCode: 'Enter invite code (e.g. ABCD-1234)',
      groupName: 'Circle Name',
      groupNamePlaceholder: 'e.g. Family Prayer Circle',
      description: 'Description (optional)',
      membersCount: 'members',
      leaveGroup: 'Leave Circle',
      copyCode: 'Copy Code',
      codeCopied: 'Code copied!',
      noGroups: 'You have not joined any circles yet. Create a new circle or join with an invite code!',
      owner: 'Owner',
      member: 'Member',
      tabGlobal: 'Global Leaderboard',
      tabGroups: 'My Circles',
    },
    progress: {
      title: 'Personal Progress',
      subtitle: 'Prayer history, consistency analytics, and qaza tracking',
      signInPrompt: 'Sign in to unlock multi-device cloud history, long-term analytics, and automated streaks.',
      tabs: {
        overview: 'Overview',
        history: 'History & Calendar',
        analytics: 'Analytics',
        qaza: 'Qaza & Accountability',
      },
      summary: {
        completionRate: 'Completion',
        onTimeRate: 'On Time',
        missedPrayers: 'Missed',
        madeUpPrayers: 'Made Up',
        currentStreak: 'Current Streak',
        bestStreak: 'Best Streak',
        totalLogged: 'Total Logged',
        qazaBalance: 'Qaza Balance',
      },
      periods: {
        d7: '7 Days',
        d30: '30 Days',
        custom: 'Custom',
      },
      insights: {
        title: 'Analytical Insights',
        mostConsistent: 'Most Consistent Prayer',
        needsAttention: 'Needs Attention',
        streakEncouragement: 'Excellent momentum! Keep performing prayers in their preferred windows.',
        qazaGoal: 'Qaza Payoff Target',
      },
      prayersCompletedRecord: 'prayers completed',
      consistencyTitle: 'Consistency by Prayer',
      consistencySubtitle: 'On-time completion share for each prayer',
      calculatorTitle: 'Qaza Payoff Projection Calculator',
      dailyOneExtra: 'With 1 extra prayer made up daily',
      dailyFiveExtra: 'With 1 full day (5 prayers) made up daily',
      daysToComplete: 'days to completely fulfill',
      historicalEditNotice: 'You can correct past records. Future dates cannot be logged.',
      editRecord: 'Edit Record',
      doneEditing: 'Done',
      futureDateError: 'Cannot log prayers for future dates',
      accountabilityBreakdown: 'Accountability & Fine Breakdown',
      baseFine: 'Base discipline fine (15,000 UZS per missed prayer)',
      overdueFine: 'Overdue penalty after 7 days (+15,000 UZS)',
      daysOverdue: 'days since prayer date',
      noFines: 'No outstanding fines or debts',
      settledAmount: 'Recorded settled / donated amount',
      recordPayment: 'Record Settlement / Sadaqah',
      recordPaymentDesc: 'This is a personal self-discipline mechanism, not a religious ruling.',
    },
    account: {
      title: 'Account & Settings',
      subtitle: 'Manage your profile, prayer calculation, and security',
      signInTitle: 'Sign In to Access Your Cloud Account',
      signInSubtitle: 'Create an account or sign in to configure personalized calculation methods, join accountability circles, and secure your prayer journal.',
      languageSubtitle: 'Application interface language',
      argonSecurityNote: 'Password securely hashed with Argon2id',
      showPassword: 'Show passwords',
      hidePassword: 'Hide passwords',
      secureSessionTitle: 'Secure Server-Side Session',
      secureSessionDesc: 'Your session is stored securely in the server database (MongoDB) and protected with an HttpOnly, SameSite=Lax cookie. It is immediately invalidated by the server when you log out or your session expires.',
      tabs: {
        profile: 'Profile',
        preferences: 'Preferences',
        privacy: 'Privacy',
        security: 'Security',
      },
      sections: {
        personalInfo: 'Personal Information',
        personalInfoDesc: 'Your display name and identification on SalahTrack',
        preferences: 'Preferences & Calculation',
        preferencesDesc: 'App interface language and astronomical prayer time calculation method',
        privacy: 'Privacy & Community',
        privacyDesc: 'Public leaderboard visibility and accountability circles',
        security: 'Security & Sessions',
        securityDesc: 'Change your password and manage secure server sessions',
      },
    },
  },

  uz: {
    appTitle: 'SalahTrack',
    appSubtitle: 'Namoz va shaxsiy intizom trekeri',
    common: {
      hoursUnit: 'soat',
      minsUnit: 'daqiqa',
      currency: 'UZS',
      activeLocalProfile: 'Faol profil',
      loading: 'Yuklanmoqda...',
      save: 'Saqlash',
      saved: 'Saqlandi',
      cancel: 'Bekor qilish',
      error: 'Xatolik yuz berdi',
      success: 'Muvaffaqiyatli',
    },
    nav: {
      home: 'Bosh sahifa',
      progress: 'Natijalar',
      leaderboard: 'Reyting',
      qibla: 'Qibla',
      account: 'Hisob',
      history: 'Tarix',
      stats: 'Statistika',
      profile: 'Profil',
      login: 'Kirish',
      signup: 'Ro‘yxatdan o‘tish',
      logout: 'Chiqish',
    },
    auth: {
      login: {
        title: 'Tizimga kirish',
        subtitle: 'Namozlaringizni kuzatish va sinxronizatsiya qilish uchun hisobingizga kiring',
        identifierLabel: 'Email yoki foydalanuvchi nomi',
        identifierPlaceholder: 'name@example.com yoki username',
        passwordLabel: 'Parol',
        passwordPlaceholder: 'Parolingizni kiriting',
        rememberMe: 'Meni 30 kunga eslab qolish',
        submit: 'Kirish',
        submitting: 'Kirilmoqda...',
        noAccount: 'Hisobingiz yo‘qmi?',
        signupLink: 'Ro‘yxatdan o‘tish',
        forgotPasswordLink: 'Parolni unutdingizmi?',
        invalidCredentials: 'Email/foydalanuvchi nomi yoki parol noto‘g‘ri',
        rateLimited: 'Urinishlar soni oshib ketdi. 15 daqiqadan so‘ng qayta urinib ko‘ring.',
        loginSuccess: 'Tizimga muvaffaqiyatli kirildi',
      },
      signup: {
        title: 'Ro‘yxatdan o‘tish',
        subtitle: 'Namozlarni o‘z vaqtida ado etish va shaxsiy intizom yo‘lini boshlang',
        nameLabel: 'To‘liq ism',
        namePlaceholder: 'Ahmad Aliyev',
        usernameLabel: 'Foydalanuvchi nomi',
        usernamePlaceholder: 'ahmad_aliyev',
        emailLabel: 'Elektron pochta',
        emailPlaceholder: 'ahmad@example.com',
        passwordLabel: 'Parol',
        passwordPlaceholder: 'Kamida 8 belgi (katta, kichik harf, raqam va belgi)',
        confirmPasswordLabel: 'Parolni tasdiqlang',
        confirmPasswordPlaceholder: 'Parolni qayta kiriting',
        termsPledge: 'Shaxsiy intizom va o‘z-o‘zini nazorat qilish shartlarini qabul qilaman',
        submit: 'Hisob yaratish',
        submitting: 'Yaratilmoqda...',
        haveAccount: 'Hisobingiz bormi?',
        loginLink: 'Kirish',
        signupSuccess: 'Hisob muvaffaqiyatli yaratildi!',
      },
      forgotPassword: {
        title: 'Parolni tiklash',
        subtitle: 'Parolni tiklash havolasini olish uchun emailingizni kiriting',
        emailLabel: 'Elektron pochta',
        emailPlaceholder: 'name@example.com',
        submit: 'Tiklash havolasini yuborish',
        submitting: 'Yuborilmoqda...',
        backToLogin: 'Kirishga qaytish',
        infoNotice: 'Emailingizga 15 daqiqa davomida amal qiluvchi bir martalik havola yuboriladi.',
        successNotice: 'Agar ushbu email bilan hisob mavjud bo‘lsa, tiklash ko‘rsatmalari yuborildi.',
      },
      resetPassword: {
        title: 'Yangi parol o‘rnatish',
        subtitle: 'Hisobingiz uchun ishonchli va yangi parol tanlang',
        newPasswordLabel: 'Yangi parol',
        newPasswordPlaceholder: 'Kamida 8 ta belgi (katta/kichik harflar, raqam va maxsus belgi)',
        confirmPasswordLabel: 'Yangi parolni tasdiqlang',
        confirmPasswordPlaceholder: 'Yangi parolni qayta kiriting',
        submit: 'Parolni yangilash',
        submitting: 'Yangilanmoqda...',
        successNotice: 'Parol muvaffaqiyatli yangilandi. Yangi parol bilan tizimga kiring.',
        backToLogin: 'Kirish sahifasiga o‘tish',
        invalidToken: 'Yaroqsiz yoki muddati o‘tgan tiklash havolasi.',
      },
      validation: {
        passwordRequirements: 'Parol kamida 8 ta belgidan iborat bo‘lishi, katta va kichik harf, raqam va maxsus belgini o‘z ichiga olishi kerak.',
        passwordsMustMatch: 'Parollar mos kelmadi',
        requiredField: 'Ushbu maydon to‘ldirilishi shart',
        invalidEmail: 'Yaroqli elektron pochta manzilini kiriting',
        invalidUsername: 'Foydalanuvchi nomi 3-30 belgidan iborat bo‘lishi kerak (harf, raqam, tagchiziq)',
      },
      logout: {
        button: 'Tizimdan chiqish',
        loggingOut: 'Chiqilmoqda...',
      },
    },
    prayers: {
      fajr: 'Bomdod',
      dhuhr: 'Peshin',
      asr: 'Asr',
      maghrib: 'Shom',
      isha: 'Xufton',
    },
    statuses: {
      PENDING: 'Kutilmoqda',
      PRAYED: 'O‘qildi',
      PRAYED_ON_TIME: 'O‘z vaqtida',
      PRAYED_LATE: 'Kechiktirildi',
      MISSED: 'Qazo',
      MADE_UP: 'Ado etildi',
    },
    dashboard: {
      todayPrayers: 'Bugungi namozlar',
      completedRatio: 'Ado etildi',
      streakDays: 'kun ketma-ket',
      nextPrayer: 'Keyingi namoz',
      in: 'qoldi',
      timeNow: 'Hozirgi vaqt',
      changeStatus: 'Holatni o‘zgartirish',
      markPrayed: 'O‘qildi',
      markPrayedOnTime: 'O‘z vaqtida o‘qildi',
      markPrayedLate: 'Kechiktirib o‘qildi',
      markMissed: 'Qazo bo‘ldi',
      markMadeUp: 'Qazo o‘tildi',
      resetToPending: 'Kutilmoqdaga qaytarish',
      location: 'Toshkent',
      dailyProgressTitle: 'Bugungi natija',
      completedCountOfTotal: 'ta o‘qildi (5 tadan)',
      madeUpDistinctNote: 'O‘tilgan qazolar dastlabki kun natijasiga qo‘shilmaydi',
      saving: 'Saqlanmoqda...',
      saved: 'Saqlandi',
      saveFailed: 'Saqlashda xatolik',
      notifications: 'Eslatmalar',
      notificationsEnabled: 'Eslatmalar yoqilgan',
      notificationsBlocked: 'Brauzerda eslatmalar bloklangan',
      enableNotifications: 'Eslatmalarni yoqish',
      locationUnavailable: 'Joylashuv aniqlanmadi',
      apiError: 'Vaqtlar yangilanmadi',
      calcMethod: 'Hisoblash usuli',
    },
    accountability: {
      title: 'Qazo va shaxsiy intizom hisobi',
      disclaimer: 'Eslatma: Ushbu intizom tizimi faqat shaxsiy mas’uliyat va o‘z-o‘zini nazorat qilish vositasi bo‘lib, diniy fatvo emas.',
      qazaBalance: 'Qazo qoldig‘i',
      prayersCount: 'namoz',
      pledgeAmount: 'Intizomiy jarima',
      fulfillOne: 'Qazo ado etish (-1)',
      addMissed: 'Qazo qo‘shish (+1)',
      editCount: 'O‘zgartirish',
      save: 'Saqlash',
      cancel: 'Bekor qilish',
      baseRateNote: 'Asosiy stavka: har bir qazo uchun 15 000 UZS',
      overdueNote: 'Qazo o‘tash muddati: 7 kun, undan keyin +15 000 UZS qo‘shimcha badal',
    },
    leaderboard: {
      title: 'Muntazamlik reytingi',
      subtitle: 'Ixtiyoriy ravishda qo‘shilgan foydalanuvchilar o‘rtasidagi motivatsion jadval',
      daily: 'Kunlik',
      weekly: 'Haftalik',
      monthly: 'Oylik',
      rank: 'O‘rin',
      worshipper: 'Foydalanuvchi',
      prayersCompleted: 'Ado etildi',
      onTimeCount: 'O‘z vaqtida',
      streak: 'Ketma-ketlik',
      consistency: 'Muntazamlik',
      optInPrompt: 'Reytingda qatnashish',
      optInNotice: 'Sizning hisobingiz dastlab maxfiy holatda. Reytingda ko‘rinish uchun ishtirokni yoqing.',
      optInButton: 'Reytingda qatnashish',
      optOutButton: 'Reytingdan chiqish',
      optInStatusOn: 'Siz reytingda qatnashyapsiz',
      optInStatusOff: 'Siz reytingda yashirilgansiz',
      emptyLeaderboard: 'Tanlangan davrda qatnashuvchilar ma’lumoti mavjud emas.',
      youBadge: 'Siz',
    },
    profile: {
      title: 'Profil',
      subtitle: 'Shaxsiy ma’lumotlar va o‘z-o‘zini nazorat qilish sozlamalari',
      account: 'Hisob holati',
      accountDesc: 'SalahTrack tizimining tasdiqlangan foydalanuvchisi',
      personalInfo: 'Shaxsiy ma’lumotlar',
      fullName: 'To‘liq ism',
      username: 'Foydalanuvchi nomi',
      email: 'Email',
      saveProfile: 'Profilni saqlash',
      savingProfile: 'Saqlanmoqda...',
      profileUpdated: 'Profil muvaffaqiyatli saqlandi',
      languagePref: 'Interfeys tili',
      calcMethod: 'Namoz vaqtlarini hisoblash usuli',
      discipline: 'Mas’uliyat tizimi',
      disciplineDesc: 'Qazo qilingan namozlar uchun shaxsiy intizom parametrlari.',
      basePledge: 'Asosiy badal stavkasi',
      basePledgeDesc: 'Har bir qazo namozi uchun 15 000 UZS',
      gracePeriod: 'Qazo o‘tash muddati',
      gracePeriodDesc: 'Qo‘shimcha jarima hisoblanishidan oldin 7 kun',
      leaderboardPrivacy: 'Umumiy reytingda ko‘rinish',
      leaderboardPrivacyDesc: 'Ado etilgan namozlaringiz soni umumiy jamoaviy reytingda aks etishiga ruxsat berish',
      changePassword: 'Parolni o‘zgartirish',
      currentPassword: 'Joriy parol',
      newPassword: 'Yangi parol',
      confirmNewPassword: 'Yangi parolni tasdiqlang',
      updatePassword: 'Parolni yangilash',
      updatingPassword: 'Yangilanmoqda...',
      passwordChanged: 'Parol muvaffaqiyatli yangilandi',
      logoutButton: 'Tizimdan chiqish',
    },
    history: {
      title: 'Namozlar tarixi',
      subtitle: 'Tanlangan kun, hafta va oy uchun o‘qilgan namozlar jurnali',
      dailyView: 'Kunlik',
      weeklyView: 'Haftalik',
      monthlyView: 'Oylik',
      selectDate: 'Sanani tanlash',
      noRecords: 'Ushbu davr uchun namoz yozuvlari topilmadi',
      prayersCompleted: 'Ado etilgan namozlar',
      comingSoon: 'Namozlar tarixi moduli ishlab chiqilmoqda.',
    },
    stats: {
      title: 'Statistika va tahlil',
      subtitle: 'O‘z vaqtida ado etish, seriyalar va majburiyatlar bo‘yicha aniq ko‘rsatkichlar',
      todayCompletion: 'Bugun',
      weeklyCompletion: '7 kun',
      monthlyCompletion: '30 kun',
      onTimeCount: 'O‘z vaqtida',
      lateCount: 'Kechiktirib',
      missedCount: 'Qazo',
      madeUpCount: 'Ado etildi',
      currentStreak: 'Joriy seriya',
      bestStreak: 'Eng yaxshi seriya',
      accountabilityAmount: 'Intizomiy badal summasi',
      consistencyScore: 'Umumiy muntazamlik',
      comingSoon: 'Statistika moduli ishlab chiqilmoqda.',
    },
    qibla: {
      title: 'Qibla yo‘nalishi',
      subtitle: 'Muqaddas Ka’ba tomon aniq azimut hisobi (21.4225° N, 39.8262° E)',
      headingToKaaba: 'Ka’ba yo‘nalishi',
      directionBearing: 'Kompas azimuti',
      compassSensor: 'Qurilma kompas datchigi faol',
      numericFallback: 'Koordinatali matnli azimut ko‘rsatkichi',
      compassCalibrating: 'Yo‘nalish datchigi kalibrlanmoqda...',
      permissionDenied: 'Geolokatsiyaga ruxsat berilmadi. Toshkent shahrining standart koordinatalari ishlatilmoqda.',
      distanceToKaaba: 'Ka’bagacha masofa',
      kmUnit: 'km',
      comingSoon: 'Qibla yo‘nalishi moduli ishlab chiqilmoqda.',
    },
    settings: {
      title: 'Sozlamalar',
      subtitle: 'Ilova parametrlarini boshqarish',
      desc: 'Sozlamalar va parametrlar.',
    },
    calculator: {
      title: 'Qazo kalkulyatori',
      subtitle: 'O‘tgan davrlardagi qazo namozlarini hisoblash',
      desc: 'Qazo hisoblash shakli.',
    },
    qaza: {
      title: 'Qazo daftari',
      subtitle: 'Qazolarni nazorat qilish va o‘tash',
      desc: 'Qazo hisobi bo‘limi.',
    },
    analytics: {
      title: 'Tahlil',
      subtitle: 'Muntazamlik ko‘rsatkichlari va grafiklar',
      desc: 'Tahliliy ma’lumotlar.',
    },
    calendar: {
      title: 'Taqvim',
      subtitle: 'Oylik namoz taqvimi',
      desc: 'Taqvim ko‘rinishi.',
    },
    groups: {
      title: 'Mas’uliyat guruhlari',
      subtitle: 'Do‘stlar va oila a’zolari bilan birga namozlarni kuzatib boring',
      createGroup: 'Guruh yaratish',
      joinGroup: 'Kod bilan qo‘shilish',
      inviteCode: 'Taklif kodi',
      enterInviteCode: 'Taklif kodini kiriting (masalan, ABCD-1234)',
      groupName: 'Guruh nomi',
      groupNamePlaceholder: 'masalan, Oila a’zolari',
      description: 'Tavsif (ixtiyoriy)',
      membersCount: 'a’zolar',
      leaveGroup: 'Guruhdan chiqish',
      copyCode: 'Kodni nusxalash',
      codeCopied: 'Kod nusxalandi!',
      noGroups: 'Hozircha hech qanday guruhga qo‘shilmagansiz. Yangi guruh yarating yoki kod orqali qo‘shiling!',
      owner: 'Egasidir',
      member: 'A’zo',
      tabGlobal: 'Umumiy reyting',
      tabGroups: 'Mening guruhlarim',
    },
    progress: {
      title: 'Shaxsiy rivojlanish',
      subtitle: 'Namozlar tarixi, muntazamlik ko‘rsatkichlari va qazo hisobi',
      signInPrompt: 'Bulutli tarix, uzoq muddatli tahlillar va avtomatik davomiylik zanjirini ochish uchun tizimga kiring.',
      tabs: {
        overview: 'Umumiy ko‘rinish',
        history: 'Tarix va taqvim',
        analytics: 'Tahlil',
        qaza: 'Qazo va javobgarlik',
      },
      summary: {
        completionRate: 'Bajarilish',
        onTimeRate: 'O‘z vaqtida',
        missedPrayers: 'Qoldirilgan',
        madeUpPrayers: 'Qazosi o‘qilgan',
        currentStreak: 'Ketma-ketlik',
        bestStreak: 'Eng yaxshi natija',
        totalLogged: 'Jami belgilangan',
        qazaBalance: 'Qazo balansi',
      },
      periods: {
        d7: '7 kun',
        d30: '30 kun',
        custom: 'Boshqa davr',
      },
      insights: {
        title: 'Tahliliy xulosalar',
        mostConsistent: 'Eng barqaror namoz',
        needsAttention: 'E’tibor talab qiladi',
        streakEncouragement: 'Ajoyib natija! Namozlarni o‘z vaqtida ado etishda davom eting.',
        qazaGoal: 'Qazolarni to‘lash maqsadi',
      },
      prayersCompletedRecord: 'namoz ado etildi',
      consistencyTitle: 'Namozlar kesimida muntazamlik',
      consistencySubtitle: 'Har bir namozning o‘z vaqtida ado etilish ulushi',
      calculatorTitle: 'Qazolarni to‘lash hisoblagichi',
      dailyOneExtra: 'Har kuni 1 ta qo‘shimcha namoz o‘qilsa',
      dailyFiveExtra: 'Har kuni 1 kunlik (5 ta) qazo o‘qilsa',
      daysToComplete: 'kunda to‘liq yopiladi',
      historicalEditNotice: 'O‘tgan kunlar yozuvlarini to‘g‘rilash mumkin. Kelajak sanalar bloklangan.',
      editRecord: 'Yozuvni tahrirlash',
      doneEditing: 'Tayyor',
      futureDateError: 'Kelajak sanalar uchun namoz belgilanmaydi',
      accountabilityBreakdown: 'Shaxsiy intizom va badal hisobi',
      baseFine: 'Asosiy intizom badali (har bir qazo uchun 15 000 UZS)',
      overdueFine: '7 kundan oshgan qazo uchun qo‘shimcha jarima (+15 000 UZS)',
      daysOverdue: 'kun o‘tdi',
      noFines: 'Hisoblangan intizomiy jarimalar mavjud emas',
      settledAmount: 'Qayd etilgan / to‘langan xayriya summasi',
      recordPayment: 'Hisob-kitobni qayd etish / Ehson',
      recordPaymentDesc: 'Ushbu tizim faqat shaxsiy intizom va o‘z-o‘zini hisobga tortish vositasi bo‘lib, shariat fatvosi emas.',
    },
    account: {
      title: 'Hisob va sozlamalar',
      subtitle: 'Profil ma’lumotlari, namoz hisoblash usuli va xavfsizlik',
      signInTitle: 'Bulutli hisobingizga kiring',
      signInSubtitle: 'Shaxsiy hisob-kitob usullarini sozlash, mas’uliyat doiralariga qo‘shilish va namoz daftaringizni himoyalash uchun hisobingizga kiring.',
      languageSubtitle: 'Ilova interfeysi tili',
      argonSecurityNote: 'Argon2id bilan xavfsiz himoyalangan parol',
      showPassword: 'Parollarni ko‘rsatish',
      hidePassword: 'Parollarni yashirish',
      secureSessionTitle: 'Himoyalangan server seansi',
      secureSessionDesc: 'Sizning sessiyangiz xavfsiz server bazasida (MongoDB) saqlanadi va HttpOnly, SameSite=Lax cookie orqali himoyalangan. Brauzer yopilganda yoki tizimdan chiqqaningizda sessiya server tomonidan darhol bekor qilinadi.',
      tabs: {
        profile: 'Profil',
        preferences: 'Sozlamalar',
        privacy: 'Maxfiylik',
        security: 'Xavfsizlik',
      },
      sections: {
        personalInfo: 'Shaxsiy ma’lumotlar',
        personalInfoDesc: 'SalahTrack-dagi ismingiz va identifikatsiya ma’lumotlaringiz',
        preferences: 'Sozlamalar va hisoblash',
        preferencesDesc: 'Ilova tili va astronomik namoz vaqtini hisoblash uslubi',
        privacy: 'Maxfiylik va guruhlar',
        privacyDesc: 'Umumiy reytingda ko‘rinish va shaxsiy mas’uliyat guruhlari',
        security: 'Xavfsizlik va seanslar',
        securityDesc: 'Parolni yangilash va himoyalangan server seanslarini boshqarish',
      },
    },
  },
};

export type TranslationKey = TranslationContent;
