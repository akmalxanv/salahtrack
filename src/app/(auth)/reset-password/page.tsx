'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, Lock, Check, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function ResetPasswordPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const passwordChecks = useMemo(() => {
    return {
      length: newPassword.length >= 8 && newPassword.length <= 128,
      lowercase: /[a-z]/.test(newPassword),
      uppercase: /[A-Z]/.test(newPassword),
      number: /[0-9]/.test(newPassword),
      special: /[^a-zA-Z0-9]/.test(newPassword),
    };
  }, [newPassword]);

  const isPasswordStrong =
    passwordChecks.length &&
    passwordChecks.lowercase &&
    passwordChecks.uppercase &&
    passwordChecks.number &&
    passwordChecks.special;

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!token) {
      setErrorMessage(t.auth.resetPassword.invalidToken);
      return;
    }

    if (!isPasswordStrong) {
      setErrorMessage(t.auth.validation.passwordRequirements);
      return;
    }

    if (!passwordsMatch) {
      setErrorMessage(t.auth.validation.passwordsMustMatch);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          newPassword,
          confirmPassword,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setSuccessMessage(json.message || t.auth.resetPassword.successNotice);
        setTimeout(() => {
          router.push('/login');
        }, 2000);
      } else {
        setErrorMessage(json.error || t.auth.resetPassword.invalidToken);
      }
    } catch {
      setErrorMessage(t.common.error);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 sm:p-8 space-y-6 text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 mx-auto flex items-center justify-center">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {t.auth.resetPassword.invalidToken}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Please request a new reset link to proceed.
          </p>
        </div>
        <Link
          href="/forgot-password"
          className="inline-block py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-xl transition-colors"
        >
          {t.auth.forgotPassword.submit}
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 sm:p-8 space-y-6">
      {/* Title & Subtitle */}
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {t.auth.resetPassword.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t.auth.resetPassword.subtitle}
        </p>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-sm animate-in fade-in duration-200"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
          <div className="flex-1 font-medium">{errorMessage}</div>
        </div>
      )}

      {/* Success Alert */}
      {successMessage && (
        <div
          role="status"
          className="flex items-center gap-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 text-sm"
        >
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="flex-1 font-medium">{successMessage}</div>
        </div>
      )}

      {/* Reset Password Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* New Password */}
        <div className="space-y-1.5">
          <label
            htmlFor="newPassword"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
          >
            {t.auth.resetPassword.newPasswordLabel}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="newPassword"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t.auth.resetPassword.newPasswordPlaceholder}
              className="w-full pl-10 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Real-time Password Strength Criteria */}
          {newPassword.length > 0 && (
            <div className="p-2.5 rounded-lg bg-slate-100/70 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 space-y-1 text-xs">
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                {passwordChecks.length ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <X className="w-3.5 h-3.5 text-slate-400" />}
                <span>8-128 characters</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                {passwordChecks.uppercase && passwordChecks.lowercase ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <X className="w-3.5 h-3.5 text-slate-400" />}
                <span>Uppercase & lowercase letters</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                {passwordChecks.number && passwordChecks.special ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <X className="w-3.5 h-3.5 text-slate-400" />}
                <span>Number & special character</span>
              </div>
            </div>
          )}
        </div>

        {/* Confirm New Password */}
        <div className="space-y-1.5">
          <label
            htmlFor="confirmResetPassword"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
          >
            {t.auth.resetPassword.confirmPasswordLabel}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="confirmResetPassword"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t.auth.resetPassword.confirmPasswordPlaceholder}
              className={`w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-colors ${
                confirmPassword && !passwordsMatch
                  ? 'border-red-400 focus:border-red-500'
                  : 'border-slate-200 dark:border-slate-700 focus:border-emerald-500'
              }`}
            />
          </div>
          {confirmPassword && !passwordsMatch && (
            <p className="text-xs text-red-500">{t.auth.validation.passwordsMustMatch}</p>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || !isPasswordStrong || !passwordsMatch}
          className="w-full mt-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium text-sm rounded-xl shadow-md shadow-emerald-600/20 hover:shadow-emerald-600/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t.auth.resetPassword.submitting}</span>
            </>
          ) : (
            <span>{t.auth.resetPassword.submit}</span>
          )}
        </button>
      </form>

      {/* Back to Login link */}
      <div className="pt-2 text-center text-xs">
        <Link
          href="/login"
          className="font-semibold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 hover:underline"
        >
          {t.auth.resetPassword.backToLogin}
        </Link>
      </div>
    </div>
  );
}
