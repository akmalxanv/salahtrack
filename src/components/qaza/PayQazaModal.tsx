'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  X,
  AlertCircle,
  CheckCircle2,
  HeartHandshake,
  Loader2,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import type {
  PrayerId,
  AccountabilityBreakdownItem,
  OutstandingQazaItem,
} from '@/types/prayer';
import {
  calculateAccountabilityLedger,
  type PayableQazaItem,
} from '@/lib/accountability';
import { formatCurrency } from '@/lib/formatters';
import {
  getStoredHistoryRecords,
  saveStoredHistoryRecords,
  dispatchStorageUpdate,
} from '@/lib/storage-sync';

export type { PayableQazaItem };

export interface PayQazaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialItems?: OutstandingQazaItem[] | AccountabilityBreakdownItem[];
}

export default function PayQazaModal({
  isOpen,
  onClose,
  onSuccess,
  initialItems,
}: PayQazaModalProps) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();

  const [items, setItems] = useState<PayableQazaItem[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const getItemKey = (item: { date: string; prayerId: PrayerId }): string =>
    `${item.date}:${item.prayerId}`;

  // Helper to derive payable items from local storage history using single source of truth
  const loadLocalPayableItems = useCallback((): PayableQazaItem[] => {
    const history = getStoredHistoryRecords();
    return calculateAccountabilityLedger(history, Date.now()).items;
  }, []);

  // Fetch or populate items whenever modal opens
  useEffect(() => {
    if (!isOpen) return;

    let isCancelled = false;

    async function populateItems() {
      await Promise.resolve();
      if (isCancelled) return;
      setLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      // If initial items were supplied and non-empty, normalize them
      if (initialItems && initialItems.length > 0) {
        const mapped: PayableQazaItem[] = initialItems.map((it) => {
          const totalAmount = 'totalAmount' in it ? it.totalAmount : it.amount;
          const baseAmount = 'baseAmount' in it ? it.baseAmount : 15000;
          const overdueAmount = 'overdueAmount' in it ? it.overdueAmount : totalAmount - baseAmount;
          return {
            date: it.date,
            prayerId: it.prayerId,
            status: it.status || 'MISSED',
            amount: totalAmount,
            totalAmount,
            baseAmount,
            overdueAmount,
            isOverdue: it.isOverdue,
            daysPassed: it.daysPassed,
          };
        });
        if (!isCancelled) {
          setItems(mapped);
          setSelectedKeys(new Set(mapped.map(getItemKey)));
          setLoading(false);
        }
        return;
      }

      // If user is authenticated, query /api/stats to get server breakdown
      if (user) {
        try {
          const res = await fetch('/api/stats');
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data?.accountability?.breakdown)) {
              const breakdown: AccountabilityBreakdownItem[] = json.data.accountability.breakdown;
              const mapped: PayableQazaItem[] = breakdown.map((it) => ({
                date: it.date,
                prayerId: it.prayerId,
                status: it.status || 'MISSED',
                amount: it.totalAmount,
                totalAmount: it.totalAmount,
                baseAmount: it.baseAmount,
                overdueAmount: it.overdueAmount,
                isOverdue: it.isOverdue,
                daysPassed: it.daysPassed,
              }));

              if (!isCancelled) {
                setItems(mapped);
                setSelectedKeys(new Set(mapped.map(getItemKey)));
                setLoading(false);
                return;
              }
            }
          }
        } catch (err) {
          console.warn('Could not fetch server stats for qaza payment modal, falling back to local:', err);
        }
      }

      // Fallback: derive from local storage
      const localItems = loadLocalPayableItems();
      if (!isCancelled) {
        setItems(localItems);
        setSelectedKeys(new Set(localItems.map(getItemKey)));
        setLoading(false);
      }
    }

    populateItems();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, initialItems, user, loadLocalPayableItems]);

  // Lock body scroll and focus management
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus close button on open
    setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Selected items list & verification
  const selectedItems = useMemo(() => {
    return items.filter((it) => selectedKeys.has(getItemKey(it)));
  }, [items, selectedKeys]);

  // Select all / deselect all
  const isAllSelected = useMemo(() => {
    return items.length > 0 && selectedKeys.size === items.length;
  }, [items, selectedKeys]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(items.map(getItemKey)));
    }
  };

  const handleToggleItem = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Total outstanding debt across all items
  const totalDebt = useMemo(() => {
    return items.reduce((sum, it) => sum + it.amount, 0);
  }, [items]);

  // Selected fine amount total
  const selectedTotal = useMemo(() => {
    return selectedItems.reduce((sum, it) => sum + it.amount, 0);
  }, [selectedItems]);

  const remainingBalance = Math.max(0, totalDebt - selectedTotal);
  const selectedCount = selectedKeys.size;

  // Confirm payment settlement
  const handleConfirmSettlement = async () => {
    if (selectedCount === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (user) {
        // Authenticated: submit to server
        const res = await fetch('/api/prayers/qaza-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: selectedItems.map((it) => ({
              date: it.date,
              prayerId: it.prayerId,
            })),
            idempotencyKey: `sadaqah-pay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || t.accountability.paymentError);
        }
      }

      // Update local storage history records (preserve original status; mark as isPaid)
      const history = getStoredHistoryRecords();
      const nowIso = new Date().toISOString();

      for (const item of selectedItems) {
        const dateRecord = history[item.date];
        if (dateRecord?.prayers?.[item.prayerId]) {
          dateRecord.prayers[item.prayerId] = {
            ...dateRecord.prayers[item.prayerId],
            // Crucial: preserve existing status! (Do NOT force to 'MADE_UP')
            isPaid: true,
            paidAt: nowIso,
            paidAmount: item.amount,
          };
        }
      }
      saveStoredHistoryRecords(history);

      // Update local settled donations accumulator
      try {
        const rawSettled = window.localStorage.getItem('salahtrack_settled_donations');
        const currentSettled = rawSettled ? JSON.parse(rawSettled) : 0;
        const newSettled = (typeof currentSettled === 'number' ? currentSettled : 0) + selectedTotal;
        window.localStorage.setItem('salahtrack_settled_donations', JSON.stringify(newSettled));
      } catch {
        // ignore
      }

      // Notify other components & tabs
      dispatchStorageUpdate();

      setSuccessMessage(t.accountability.paymentSuccess);
      onSuccess?.();

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      console.error('Payment error:', err);
      setErrorMessage((err as Error)?.message || t.accountability.paymentError);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs transition-opacity duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pay-qaza-modal-title"
      aria-describedby="pay-qaza-modal-desc"
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h2
              id="pay-qaza-modal-title"
              className="text-lg font-bold text-slate-900 dark:text-slate-100"
            >
              {t.accountability.payModalTitle}
            </h2>
            <p
              id="pay-qaza-modal-desc"
              className="text-xs text-slate-500 dark:text-slate-400 mt-0.5"
            >
              {t.accountability.payModalDesc}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t.common.cancel}
            className="min-h-[44px] min-w-[44px] -mr-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Prominent Educational Reminder */}
          <div className="p-3.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <p className="text-[11px] leading-relaxed font-medium">
              {t.accountability.sadaqahNotice}
            </p>
          </div>

          {/* Status Banners */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <span className="text-xs">{t.common.loading}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 p-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                {t.accountability.noOutstanding}
              </p>
            </div>
          ) : (
            <>
              {/* Select All Toggle Bar */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {selectedCount} / {items.length} {t.accountability.prayersCount}
                </span>
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer"
                >
                  {isAllSelected ? t.accountability.deselectAll : t.accountability.selectAll}
                </button>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                {items.map((item) => {
                  const key = getItemKey(item);
                  const isSelected = selectedKeys.has(key);
                  const isMadeUp = item.status === 'MADE_UP';

                  return (
                    <label
                      key={key}
                      className={`min-h-[44px] flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer select-none ${
                        isSelected
                          ? 'border-emerald-500/80 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-700/80'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleItem(key)}
                            className="w-5 h-5 rounded-md border-slate-300 dark:border-slate-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer accent-emerald-600"
                          />
                        </div>

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                              {item.date}
                            </span>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 capitalize">
                              {t.prayers[item.prayerId]}
                            </span>
                            {isMadeUp ? (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                                {t.accountability.statusMadeUpSpiritualDone}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                {t.accountability.statusMissedNeedsMakeup}
                              </span>
                            )}
                            {!isMadeUp && item.isOverdue && (
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300"
                                title={t.accountability.overdueWhyReason}
                              >
                                {t.accountability.overdueExplanation}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                            {formatCurrency(item.baseAmount, lang)} {t.accountability.baseDebtLabel}
                            {item.overdueAmount > 0 &&
                              ` + ${formatCurrency(item.overdueAmount, lang)} ${t.accountability.overduePenaltyLabel}`}
                          </p>
                        </div>
                      </div>

                      <div className="text-right pl-3">
                        <span
                          className={`text-sm font-black tracking-tight ${
                            isMadeUp
                              ? 'text-sky-700 dark:text-sky-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {formatCurrency(item.amount, lang)}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer with Summary, Running Total, Remaining Balance, and Action Buttons */}
        {items.length > 0 && (
          <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 shrink-0 space-y-3">
            <div className="space-y-1.5 py-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400 font-medium">
                  {t.accountability.selectedTotal} ({selectedCount}):
                </span>
                <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(selectedTotal, lang)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{t.accountability.remainingBalanceLabel}:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {formatCurrency(remainingBalance, lang)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="min-h-[44px] flex-1 py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50"
              >
                {t.common.cancel}
              </button>

              <button
                type="button"
                onClick={handleConfirmSettlement}
                disabled={selectedCount === 0 || isSubmitting}
                className="min-h-[44px] flex-[2] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t.accountability.confirming}</span>
                  </>
                ) : (
                  <>
                    <HeartHandshake className="w-4 h-4" />
                    <span>{t.accountability.confirmPayment}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
