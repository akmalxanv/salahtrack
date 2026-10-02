'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, Lock, Mail, User, Check, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';

export default function SignupPage() {
  const { t } = useLanguage();
  const { signup } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Live password strength calculation
  const passwordChecks = useMemo(() => {
    return {
      length: password.length >= 8 && password.length <= 128,
      lowercase: /[a-z]/.test(password),
      uppercase: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^a-zA-Z0-9]/.test(password),
    };
  }, [password]);

  const isPasswordStrong =
    passwordChecks.length &&
    passwordChecks.lowercase &&
    passwordChecks.uppercase &&
    passwordChecks.number &&
    passwordChecks.special;

  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!termsAgreed) {
      setErrorMessage(t.auth.signup.termsPledge);
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
      const result = await signup({
        name: name.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
        confirmPassword,
      });

      if (result.success) {
        setSuccessMessage(t.auth.signup.signupSuccess);
        setTimeout(() => {
          router.push('/');
          router.refresh();
        }, 500);
      } else {
        setErrorMessage(result.error || t.common.error);
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
          {t.auth.signup.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t.auth.signup.subtitle}
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

      {/* Signup Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Full Name */}
        <div className="space-y-1.5">
          <label
            htmlFor="name"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
          >
            {t.auth.signup.nameLabel}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <User className="w-4 h-4" />
            </div>
            <input
              id="name"
              type="text"
              required
              minLength={2}
              maxLength={50}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.auth.signup.namePlaceholder}
              className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>

        {/* Username */}
        <div className="space-y-1.5">
          <label
            htmlFor="username"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
          >
            {t.auth.signup.usernameLabel}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <span className="text-xs font-bold text-slate-400">@</span>
            </div>
            <input
              id="username"
              type="text"
              required
              pattern="^[a-zA-Z0-9_]{3,30}$"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder={t.auth.signup.usernamePlaceholder}
              className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>

        {/* Email */}
        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
          >
            {t.auth.signup.emailLabel}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Mail className="w-4 h-4" />
            </div>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.auth.signup.emailPlaceholder}
              className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label
            htmlFor="signupPassword"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
          >
            {t.auth.signup.passwordLabel}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="signupPassword"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.auth.signup.passwordPlaceholder}
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
          {password.length > 0 && (
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

        {/* Confirm Password */}
        <div className="space-y-1.5">
          <label
            htmlFor="confirmPassword"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
          >
            {t.auth.signup.confirmPasswordLabel}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t.auth.signup.confirmPasswordPlaceholder}
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

        {/* Terms / Pledge Acknowledgement */}
        <div className="flex items-start gap-2.5 pt-1">
          <input
            id="terms"
            type="checkbox"
            required
            checked={termsAgreed}
            onChange={(e) => setTermsAgreed(e.target.checked)}
            className="w-4 h-4 mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:checked:bg-emerald-600 shrink-0"
          />
          <label htmlFor="terms" className="text-xs text-slate-600 dark:text-slate-400 leading-snug cursor-pointer">
            {t.auth.signup.termsPledge}
          </label>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || !termsAgreed || !isPasswordStrong || !passwordsMatch}
          className="w-full mt-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium text-sm rounded-xl shadow-md shadow-emerald-600/20 hover:shadow-emerald-600/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t.auth.signup.submitting}</span>
            </>
          ) : (
            <span>{t.auth.signup.submit}</span>
          )}
        </button>
      </form>

      {/* Login Redirection Link */}
      <div className="pt-2 text-center text-xs text-slate-500 dark:text-slate-400">
        <span>{t.auth.signup.haveAccount} </span>
        <Link
          href="/login"
          className="font-semibold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 hover:underline"
        >
          {t.auth.signup.loginLink}
        </Link>
      </div>
    </div>
  );
}
