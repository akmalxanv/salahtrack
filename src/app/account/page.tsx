'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  User as UserIcon,
  ShieldCheck,
  Globe,
  Compass,
  Trophy,
  KeyRound,
  LogOut,
  LogIn,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Scale,
  Clock,
  Users,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import GroupsManager from '@/components/GroupsManager';
import type { Language } from '@/locales/translations';

const CALCULATION_METHODS = [
  { id: 'MWL', name: 'Muslim World League (MWL)' },
  { id: 'ISNA', name: 'Islamic Society of North America (ISNA)' },
  { id: 'Egypt', name: 'Egyptian General Authority of Survey' },
  { id: 'Makkah', name: 'Umm al-Qura University, Makkah' },
  { id: 'Karachi', name: 'University of Islamic Sciences, Karachi' },
  { id: 'Tehran', name: 'Institute of Geophysics, University of Tehran' },
];

type AccountTab = 'profile' | 'preferences' | 'privacy' | 'security';

function AccountContent() {
  const { t, lang, setLang } = useLanguage();
  const { user, refreshUser, logout } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialTab = (searchParams.get('tab') as AccountTab) || 'profile';
  const [activeTab, setActiveTab] = useState<AccountTab>(initialTab);

  // Form State
  const [name, setName] = useState('');
  const [calculationMethod, setCalculationMethod] = useState('MWL');
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Sync state when user object loads
  useEffect(() => {
    if (user) {
      queueMicrotask(() => {
        setName(user.name || '');
        setCalculationMethod(user.preferences?.calculationMethod || 'MWL');
        setShowOnLeaderboard(Boolean(user.preferences?.showOnLeaderboard));
      });
    }
  }, [user]);

  const handleTabChange = (tab: AccountTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    router.replace(`/account?${params.toString()}`);
  };

  // Save Profile
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccess(null);
    setProfileError(null);
    setProfileSaving(true);

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: name.trim(),
          preferences: {
            language: lang,
            calculationMethod,
            showOnLeaderboard,
          },
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setProfileSuccess(t.profile.profileUpdated);
        await refreshUser();
        setTimeout(() => setProfileSuccess(null), 3500);
      } else {
        setProfileError(json.error || t.common.error);
      }
    } catch {
      setProfileError(t.common.error);
    } finally {
      setProfileSaving(false);
    }
  };

  // Toggle Leaderboard
  const handleToggleLeaderboard = async () => {
    const nextVal = !showOnLeaderboard;
    setShowOnLeaderboard(nextVal);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          preferences: {
            showOnLeaderboard: nextVal,
          },
        }),
      });
      if (res.ok) {
        await refreshUser();
      } else {
        setShowOnLeaderboard(!nextVal);
      }
    } catch {
      setShowOnLeaderboard(!nextVal);
    }
  };

  // Change Password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSuccess(null);
    setPasswordError(null);

    if (newPassword !== confirmNewPassword) {
      setPasswordError(t.auth.validation.passwordsMustMatch);
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(t.auth.validation.passwordRequirements);
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword: confirmNewPassword,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setPasswordSuccess(t.profile.passwordChanged);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setTimeout(() => setPasswordSuccess(null), 3500);
      } else {
        setPasswordError(json.error || t.common.error);
      }
    } catch {
      setPasswordError(t.common.error);
    } finally {
      setPasswordSaving(false);
    }
  };

  // Unauthenticated View
  if (!user) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <UserIcon className="w-5 h-5" />
            </span>
            <span>{t.account.title}</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.account.subtitle}
          </p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
            <UserIcon className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Sign In to Access Your Cloud Account
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Create an account or sign in to configure personalized calculation methods, join accountability circles, and secure your prayer journal.
            </p>
          </div>
          <div className="pt-2 flex items-center justify-center gap-3">
            <Link
              href="/login"
              className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              <span>{t.nav.login}</span>
            </Link>
            <Link
              href="/signup"
              className="py-2.5 px-5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors"
            >
              {t.nav.signup}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated View
  return (
    <div className="space-y-6">
      {/* Header with User Preview and Logout */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <UserIcon className="w-5 h-5" />
            </span>
            <span>{t.account.title}</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.account.subtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={() => logout()}
          className="self-start sm:self-auto py-2 px-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>{t.profile.logoutButton}</span>
        </button>
      </header>

      {/* Account Info Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-xl flex items-center justify-center shadow-md shadow-emerald-600/20 shrink-0">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                {user.name}
              </h2>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/70">
                <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>{t.profile.accountDesc}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              @{user.username} • {user.email}
            </p>
          </div>
        </div>
      </div>

      {/* Account Navigation Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav
          className="flex space-x-2 sm:space-x-4 overflow-x-auto no-scrollbar"
          aria-label="Account Tabs"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'profile'}
            onClick={() => handleTabChange('profile')}
            className={`py-3 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'profile'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>{t.account.tabs.profile}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'preferences'}
            onClick={() => handleTabChange('preferences')}
            className={`py-3 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'preferences'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>{t.account.tabs.preferences}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'privacy'}
            onClick={() => handleTabChange('privacy')}
            className={`py-3 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'privacy'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>{t.account.tabs.privacy}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'security'}
            onClick={() => handleTabChange('security')}
            className={`py-3 px-3.5 border-b-2 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'security'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>{t.account.tabs.security}</span>
          </button>
        </nav>
      </div>

      {/* ==================== TAB 1: PROFILE ==================== */}
      {activeTab === 'profile' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t.account.sections.personalInfo}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.account.sections.personalInfoDesc}
            </p>
          </div>

          {/* Feedback messages */}
          {profileSuccess && (
            <div
              role="status"
              className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{profileSuccess}</span>
            </div>
          )}
          {profileError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{profileError}</span>
            </div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="name"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
              >
                {t.profile.fullName}
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {t.auth.signup.usernameLabel}
                </span>
                <input
                  type="text"
                  disabled
                  value={`@${user.username}`}
                  className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed"
                />
              </div>

              <div className="space-y-1.5">
                <span className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {t.auth.signup.emailLabel}
                </span>
                <input
                  type="email"
                  disabled
                  value={user.email}
                  className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={profileSaving}
                className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {profileSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t.common.loading}</span>
                  </>
                ) : (
                  <span>{t.profile.saveChanges}</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== TAB 2: PREFERENCES ==================== */}
      {activeTab === 'preferences' && (
        <div className="space-y-6">
          {/* Language Selection */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.profile.language}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Ilova interfeysi tili
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-1">
              {[
                { code: 'uz' as Language, label: "O'zbekcha" },
                { code: 'ru' as Language, label: 'Русский' },
                { code: 'en' as Language, label: 'English' },
              ].map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setLang(item.code)}
                  className={`py-3 px-3 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                    lang === item.code
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Calculation Method Selection */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                <Compass className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.profile.calculationMethod}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.profile.calculationMethodDesc}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              {CALCULATION_METHODS.map((method) => (
                <label
                  key={method.id}
                  className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                    calculationMethod === method.id
                      ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/30'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                    {method.name}
                  </span>
                  <input
                    type="radio"
                    name="calcMethod"
                    value={method.id}
                    checked={calculationMethod === method.id}
                    onChange={(e) => setCalculationMethod(e.target.value)}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                  />
                </label>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={profileSaving}
                className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {profileSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t.common.loading}</span>
                  </>
                ) : (
                  <span>{t.profile.saveChanges}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 3: PRIVACY & COMMUNITY ==================== */}
      {activeTab === 'privacy' && (
        <div className="space-y-6">
          {/* Leaderboard Visibility Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  <Trophy className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t.profile.leaderboardPrivacy}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t.profile.leaderboardPrivacyDesc}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleLeaderboard}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  showOnLeaderboard ? 'bg-emerald-600' : 'bg-slate-200 dark:bg-slate-700'
                }`}
                role="switch"
                aria-checked={showOnLeaderboard}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    showOnLeaderboard ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="pt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span
                className={`w-2 h-2 rounded-full ${
                  showOnLeaderboard ? 'bg-emerald-500' : 'bg-slate-400'
                }`}
              />
              <span>
                {showOnLeaderboard
                  ? t.leaderboard.optInStatusOn
                  : t.leaderboard.optInStatusOff}
              </span>
            </div>
          </div>

          {/* Groups Manager Embedded */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.groups.title}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.groups.subtitle}
                </p>
              </div>
            </div>
            <GroupsManager />
          </div>
        </div>
      )}

      {/* ==================== TAB 4: SECURITY ==================== */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          {/* Change Password Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.profile.changePassword}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Argon2id bilan xavfsiz himoyalangan parol
                </p>
              </div>
            </div>

            {passwordSuccess && (
              <div
                role="status"
                className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{passwordSuccess}</span>
              </div>
            )}
            {passwordError && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{passwordError}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <label
                  htmlFor="currPass"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  {t.profile.currentPassword}
                </label>
                <input
                  id="currPass"
                  type={showPasswords ? 'text' : 'password'}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="newPass"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.profile.newPassword}
                  </label>
                  <input
                    id="newPass"
                    type={showPasswords ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="confirmNewPass"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.profile.confirmNewPassword}
                  </label>
                  <input
                    id="confirmNewPass"
                    type={showPasswords ? 'text' : 'password'}
                    required
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setShowPasswords(!showPasswords)}
                  className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{showPasswords ? 'Hide passwords' : 'Show passwords'}</span>
                </button>

                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {passwordSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t.profile.updatingPassword}</span>
                    </>
                  ) : (
                    <span>{t.profile.updatePassword}</span>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Session Information Notice */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Himoyalangan server seansi
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Sizning sessiyangiz xavfsiz server bazasida (MongoDB) saqlanadi va HttpOnly, SameSite=Lax cookie orqali himoyalangan. Brauzer yopilganda yoki tizimdan chiqqaningizda sessiya server tomonidan darhol bekor qilinadi.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 flex justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      }
    >
      <AccountContent />
    </Suspense>
  );
}
