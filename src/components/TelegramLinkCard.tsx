'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Send, Loader2, CheckCircle2, AlertCircle, ExternalLink, Unlink, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

interface TelegramStatus {
  linked: boolean;
  username: string | null;
  firstName: string | null;
}

/**
 * Account card for linking a Telegram account to SalahTrack.
 * The app requests a one-time deep link; the user opens it and presses Start in the bot,
 * which completes the link server-side. The card then re-checks the status.
 */
export default function TelegramLinkCard() {
  const { t } = useLanguage();
  const tt = t.account.telegram;
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/user/telegram', { cache: 'no-store' });
      const json = await res.json();
      if (json?.success) {
        setStatus(json.data);
        if (json.data.linked) setDeepLink(null);
      }
    } catch {
      // Offline: keep the last known state
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadStatus());
  }, [loadStatus]);

  const requestLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/user/telegram', { method: 'POST' });
      const json = await res.json();
      if (json?.success) {
        setDeepLink(json.data.deepLink);
        window.open(json.data.deepLink, '_blank', 'noopener,noreferrer');
      } else {
        setError(json?.code === 'TELEGRAM_NOT_CONFIGURED' ? tt.notConfigured : tt.error);
      }
    } catch {
      setError(tt.error);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/user/telegram', { method: 'DELETE' });
      const json = await res.json();
      if (json?.success) await loadStatus();
      else setError(tt.error);
    } catch {
      setError(tt.error);
    } finally {
      setBusy(false);
    }
  };

  const linkedName = status?.username ? `@${status.username}` : status?.firstName;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 shadow-2xs space-y-4">
      <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Send className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <span>{tt.title}</span>
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{tt.description}</p>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-xl text-xs bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {status === null ? (
        <div className="flex justify-center py-2" aria-busy="true">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : status.linked ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            <span>
              {tt.linkedAs}
              {linkedName ? `: ${linkedName}` : ''}
            </span>
          </p>
          <button
            type="button"
            onClick={unlink}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-emerald-500 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Unlink className="w-3.5 h-3.5" aria-hidden="true" />}
            <span>{tt.unlink}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{tt.consent}</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={requestLink}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-sky-600 text-white hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
              <span>{tt.connect}</span>
            </button>
            {deepLink && (
              <>
                <a
                  href={deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40"
                >
                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                  <span>{tt.openBot}</span>
                </a>
                <button
                  type="button"
                  onClick={() => void loadStatus()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                  <span>{tt.checkStatus}</span>
                </button>
              </>
            )}
          </div>
          {deepLink && <p className="text-xs text-slate-500 dark:text-slate-400">{tt.linkExpires}</p>}
        </div>
      )}

      <p className="text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-3">{tt.groupHint}</p>
    </section>
  );
}
