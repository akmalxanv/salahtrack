'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, Lock, User, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const { t } = useLanguage();
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect') || '/';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!identifier.trim() || !password) {
      setErrorMessage(t.auth.validation.requiredField);
      return;
    }

    setLoading(true);
    try {
      const result = await login({
        identifier: identifier.trim(),
        password,
        rememberMe,
      });

      if (result.success) {
        setSuccessMessage(t.auth.login.loginSuccess);
        setTimeout(() => {
          router.push(redirectParam);
          router.refresh();
        }, 500);
      } else {
        setErrorMessage(result.error || t.auth.login.invalidCredentials);
      }
    } catch {
      setErrorMessage(t.common.error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 sm:p-8 space-y-6">
      {/* Title & Subtitle */}
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {t.auth.login.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t.auth.login.subtitle}
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

      {/* Login Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Identifier (Email / Username) */}
        <div className="space-y-1.5">
          <label
            htmlFor="identifier"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
          >
            {t.auth.login.identifierLabel}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <User className="w-4 h-4" />
            </div>
            <input
              id="identifier"
              type="text"
              required
              autoComplete="username email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t.auth.login.identifierPlaceholder}
              className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
            >
              {t.auth.login.passwordLabel}
            </label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 hover:underline"
            >
              {t.auth.login.forgotPasswordLink}
            </Link>
          </div>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.auth.login.passwordPlaceholder}
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
        </div>

        {/* Remember Me */}
        <div className="flex items-center gap-2 pt-1">
          <input
            id="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:checked:bg-emerald-600"
          />
          <label htmlFor="rememberMe" className="text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer">
            {t.auth.login.rememberMe}
          </label>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium text-sm rounded-xl shadow-md shadow-emerald-600/20 hover:shadow-emerald-600/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t.auth.login.submitting}</span>
            </>
          ) : (
            <span>{t.auth.login.submit}</span>
          )}
        </button>
      </form>

      {/* Signup Redirection Link */}
      <div className="pt-2 text-center text-xs text-slate-500 dark:text-slate-400">
        <span>{t.auth.login.noAccount} </span>
        <Link
          href="/signup"
          className="font-semibold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 hover:underline"
        >
          {t.auth.login.signupLink}
        </Link>
      </div>
    </div>
  );
}
