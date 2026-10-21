'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import {
  User as UserIcon,
  ShieldCheck,
  Compass,
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
import ContactCreator from '@/components/ContactCreator';

const CALCULATION_METHODS = [
  { id: 'MWL', name: 'Muslim World League (MWL)' },
  { id: 'ISNA', name: 'Islamic Society of North America (ISNA)' },
  { id: 'Egypt', name: 'Egyptian General Authority of Survey' },
  { id: 'Makkah', name: 'Umm al-Qura University, Makkah' },
  { id: 'Karachi', name: 'University of Islamic Sciences, Karachi' },
  { id: 'Tehran', name: 'Institute of Geophysics, University of Tehran' },
];

function AccountContent() {
  const { t, lang } = useLanguage();
  const { user, refreshUser, logout } = useAuth();

  // Personal Information State
  const [name, setName] = useState('');
  const [calculationMethod, setCalculationMethod] = useState('MWL');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Calculation Method Saving State
  const [calcSaving, setCalcSaving] = useState(false);
  const [calcSuccess, setCalcSuccess] = useState<string | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

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
      });
    }
  }, [user]);

  // Save Personal Info
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
            showOnLeaderboard: user?.preferences?.showOnLeaderboard ?? false,
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

  // Save Calculation Method
  const handleSaveCalcMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    setCalcSuccess(null);
    setCalcError(null);
    setCalcSaving(true);

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          preferences: {
            calculationMethod,
          },
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setCalcSuccess(t.profile.profileUpdated);
        await refreshUser();
        setTimeout(() => setCalcSuccess(null), 3500);
      } else {
        setCalcError(json.error || t.common.error);
      }
    } catch {
      setCalcError(t.common.error);
    } finally {
      setCalcSaving(false);
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
      <div className="space-y-4 sm:space-y-6">
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

        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 md:p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
            <UserIcon className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.account.signInTitle}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {t.account.signInSubtitle}
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

        <ContactCreator className="pt-2" />
      </div>
    );
  }

  // Streamlined Cohesive Authenticated View (All settings in one primary view)
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header with Title and Logout Action */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
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
          className="self-start sm:self-auto min-h-[44px] py-2 px-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>{t.profile.logoutButton}</span>
        </button>
      </header>

      {/* Account Info Profile Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-xl flex items-center justify-center shadow-md shadow-emerald-600/20 shrink-0 select-none">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                {user.name}
              </h2>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/70">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{t.profile.accountDesc}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              @{user.username} • {user.email}
            </p>
          </div>
        </div>
      </div>

      {/* Section 1: Personal Information Form */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t.account.sections.personalInfo}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.account.sections.personalInfoDesc}
          </p>
        </div>

        {/* Feedback Messages */}
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
              className="min-h-[44px] py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {profileSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.common.loading}</span>
                </>
              ) : (
                <span>{t.profile.saveProfile}</span>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Section 2: Prayer Calculation Method (Clear, Dedicated Section) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t.profile.calcMethod}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.account.sections.preferencesDesc}
          </p>
        </div>

        {calcSuccess && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{calcSuccess}</span>
          </div>
        )}
        {calcError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{calcError}</span>
          </div>
        )}

        <form onSubmit={handleSaveCalcMethod} className="space-y-4">
          <div className="space-y-2">
            {CALCULATION_METHODS.map((method) => (
              <label
                key={method.id}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                  calculationMethod === method.id
                    ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/30'
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
              type="submit"
              disabled={calcSaving}
              className="min-h-[44px] py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {calcSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.common.loading}</span>
                </>
              ) : (
                <span>{t.profile.saveProfile}</span>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Section 3: Integrated Security Settings (Password Change & Security Notice) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t.profile.changePassword}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.account.argonSecurityNote}
          </p>
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

        <form onSubmit={handleChangePassword} className="space-y-4">
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
              <span>{showPasswords ? t.account.hidePassword : t.account.showPassword}</span>
            </button>

            <button
              type="submit"
              disabled={passwordSaving}
              className="min-h-[44px] py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
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

        {/* Embedded Secure Session Notice */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                {t.account.secureSessionTitle}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {t.account.secureSessionDesc}
              </p>
            </div>
          </div>
        </div>
      </div>

      <ContactCreator className="pt-2" />
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 flex justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <AccountContent />
    </Suspense>
  );
}
