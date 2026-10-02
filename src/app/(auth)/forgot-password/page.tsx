'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Mail, Loader2, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function ForgotPasswordPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessNotice(null);

    if (!email.trim()) {
      setErrorMessage(t.auth.validation.requiredField);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setSuccessNotice(json.message || t.auth.forgotPassword.successNotice);
      } else {
        setErrorMessage(json.error || t.common.error);
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
          {t.auth.forgotPassword.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t.auth.forgotPassword.subtitle}
        </p>
      </div>

      {/* Info notice */}
      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
        {t.auth.forgotPassword.infoNotice}
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
      {successNotice ? (
        <div
          role="status"
          className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300 text-sm"
        >
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-2">
            <p className="font-medium">{successNotice}</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              Check your terminal in local dev mode to view the generated reset URL.
            </p>
          </div>
        </div>
      ) : (
        /* Form */
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="resetEmail"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
            >
              {t.auth.forgotPassword.emailLabel}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Mail className="w-4 h-4" />
              </div>
              <input
                id="resetEmail"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.auth.forgotPassword.emailPlaceholder}
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium text-sm rounded-xl shadow-md shadow-emerald-600/20 hover:shadow-emerald-600/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t.auth.forgotPassword.submitting}</span>
              </>
            ) : (
              <span>{t.auth.forgotPassword.submit}</span>
            )}
          </button>
        </form>
      )}

      {/* Back to Login link */}
      <div className="pt-2 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t.auth.forgotPassword.backToLogin}</span>
        </Link>
      </div>
    </div>
  );
}
