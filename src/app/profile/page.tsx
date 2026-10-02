'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  User as UserIcon,
  ShieldCheck,
  Scale,
  Clock,
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
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import type { Language } from '@/locales/translations';

const CALCULATION_METHODS = [
  { id: 'MWL', name: 'Muslim World League (MWL)' },
  { id: 'ISNA', name: 'Islamic Society of North America (ISNA)' },
  { id: 'Egypt', name: 'Egyptian General Authority of Survey' },
  { id: 'Makkah', name: 'Umm al-Qura University, Makkah' },
  { id: 'Karachi', name: 'University of Islamic Sciences, Karachi' },
  { id: 'Tehran', name: 'Institute of Geophysics, University of Tehran' },
];

export default function ProfilePage() {
  const { t, lang, setLang } = useLanguage();
  const { user, refreshUser, logout } = useAuth();

  // Profile Form State
  const [name, setName] = useState('');
  const [calculationMethod, setCalculationMethod] = useState('MWL');
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Change Password Form State
  const [showPasswordForm, setShowPasswordForm] = useState(false);
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

  // Handle Profile Update
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccess(null);
    setProfileError(null);
    setProfileSaving(true);

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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

  // Handle Leaderboard Toggle
  const handleToggleLeaderboard = async () => {
    const nextVal = !showOnLeaderboard;
    setShowOnLeaderboard(nextVal);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: {
            showOnLeaderboard: nextVal,
          },
        }),
      });
      if (res.ok) {
        await refreshUser();
      } else {
        setShowOnLeaderboard(!nextVal); // revert
      }
    } catch {
      setShowOnLeaderboard(!nextVal); // revert
    }
  };

  // Handle Password Change
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
        setTimeout(() => {
          setPasswordSuccess(null);
          setShowPasswordForm(false);
        }, 3000);
      } else {
        setPasswordError(json.error || t.common.error);
      }
    } catch {
      setPasswordError(t.common.error);
    } finally {
      setPasswordSaving(false);
    }
  };

  // Unauthenticated State View
  if (!user) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t.profile.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.profile.subtitle}
          </p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
            <UserIcon className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Sign In to Access Your Cloud Profile
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Create an account or sign in to track your personal prayer ledger, view cross-device history, and participate in the community leaderboard.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Link
              href="/login"
              className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-xl shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              <span>{t.nav.login}</span>
            </Link>
            <Link
              href="/signup"
              className="py-2.5 px-5 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium text-sm rounded-xl transition-all"
            >
              {t.nav.signup}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated Profile View
  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t.profile.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.profile.subtitle}
          </p>
        </div>

        <button
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

      {/* Edit Personal Info & Preferences */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            <UserIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t.profile.personalInfo}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Manage your display name, calculation standards, and localization
            </p>
          </div>
        </div>

        {profileSuccess && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{profileSuccess}</span>
          </div>
        )}

        {profileError && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{profileError}</span>
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Full Name */}
            <div className="space-y-1.5">
              <label
                htmlFor="profileName"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.profile.fullName}
              </label>
              <input
                id="profileName"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
              />
            </div>

            {/* Username (Readonly) */}
            <div className="space-y-1.5">
              <label
                htmlFor="profileUsername"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.profile.username}
              </label>
              <input
                id="profileUsername"
                type="text"
                disabled
                value={`@${user.username}`}
                className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed"
              />
            </div>

            {/* Language Preference */}
            <div className="space-y-1.5">
              <label
                htmlFor="profileLang"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
              >
                <Globe className="w-3.5 h-3.5 text-slate-400" />
                <span>{t.profile.languagePref}</span>
              </label>
              <select
                id="profileLang"
                value={lang}
                onChange={(e) => setLang(e.target.value as Language)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors cursor-pointer"
              >
                <option value="uz">O‘zbekcha (UZ)</option>
                <option value="ru">Русский (RU)</option>
                <option value="en">English (EN)</option>
              </select>
            </div>

            {/* Prayer Calculation Method */}
            <div className="space-y-1.5">
              <label
                htmlFor="profileCalc"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
              >
                <Compass className="w-3.5 h-3.5 text-slate-400" />
                <span>{t.profile.calcMethod}</span>
              </label>
              <select
                id="profileCalc"
                value={calculationMethod}
                onChange={(e) => setCalculationMethod(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors cursor-pointer"
              >
                {CALCULATION_METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={profileSaving}
            className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium text-xs rounded-xl shadow-sm shadow-emerald-600/20 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center gap-2 cursor-pointer"
          >
            {profileSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t.profile.savingProfile}</span>
              </>
            ) : (
              <span>{t.profile.saveProfile}</span>
            )}
          </button>
        </form>
      </div>

      {/* Leaderboard Privacy & Community Settings */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t.profile.leaderboardPrivacy}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
                {t.profile.leaderboardPrivacyDesc}
              </p>
            </div>
          </div>

          {/* Toggle Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={showOnLeaderboard}
            onClick={handleToggleLeaderboard}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
              showOnLeaderboard ? 'bg-emerald-600' : 'bg-slate-200 dark:bg-slate-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                showOnLeaderboard ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="pt-2">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
              showOnLeaderboard
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
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
          </span>
        </div>
      </div>

      {/* Discipline & Pledge Parameters */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t.profile.discipline}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.profile.disciplineDesc}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              <Scale className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{t.profile.basePledge}</span>
            </div>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.profile.basePledgeDesc}
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>{t.profile.gracePeriod}</span>
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.profile.gracePeriodDesc}
            </p>
          </div>
        </div>
      </div>

      {/* Security & Password Settings */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t.profile.changePassword}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Update your account password using Argon2id adaptive protection
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowPasswordForm(!showPasswordForm)}
            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 cursor-pointer"
          >
            {showPasswordForm ? t.common.cancel : t.profile.changePassword}
          </button>
        </div>

        {showPasswordForm && (
          <form onSubmit={handleChangePassword} className="space-y-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            {passwordSuccess && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{passwordSuccess}</span>
              </div>
            )}

            {passwordError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs font-medium">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{passwordError}</span>
              </div>
            )}

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
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
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
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
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
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
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
                className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium text-xs rounded-xl shadow-sm shadow-emerald-600/20 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center gap-2 cursor-pointer"
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
        )}
      </div>
    </div>
  );
}
