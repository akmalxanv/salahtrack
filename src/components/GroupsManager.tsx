'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Users,
  Plus,
  Copy,
  Check,
  LogOut,
  Clock,
  KeyRound,
  Shield,
  Loader2,
  LogIn,
  ChevronRight,
  Calendar,
  HeartHandshake,
  X,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import type { PrayerHistoryRecord } from '@/types/prayer';
import MonthlyHistoryCalendar from '@/components/calendar/MonthlyHistoryCalendar';

interface GroupSummary {
  id: string;
  name: string;
  description: string;
  inviteCode: string;
  creatorName: string;
  creatorUsername: string;
  memberCount: number;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
}

interface GroupMemberRanking {
  userId: string;
  name: string;
  username: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
  completedCount: number;
  onTimeCount: number;
  sadaqahOwed?: number;
  maxPossible: number;
  consistencyPercentage: number;
  isCurrentUser: boolean;
  rank: number;
}

interface GroupDetails {
  id: string;
  name: string;
  description: string;
  inviteCode: string;
  memberCount: number;
  period: 'daily' | 'weekly' | 'monthly';
  maxPossible: number;
  members: GroupMemberRanking[];
}

export default function GroupsManager() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroupDetails, setSelectedGroupDetails] = useState<GroupDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');

  // Modals & Action states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [joinInviteCode, setJoinInviteCode] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Member Prayer History Modal State (Read-only)
  const [historyMember, setHistoryMember] = useState<GroupMemberRanking | null>(null);
  const [memberRecords, setMemberRecords] = useState<Record<string, PrayerHistoryRecord>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDate, setHistoryDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [historyYear, setHistoryYear] = useState<number>(() => new Date().getFullYear());
  const [historyMonth, setHistoryMonth] = useState<number>(() => new Date().getMonth());

  // Fetch joined groups
  const fetchGroups = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/groups');
      const json = await res.json();
      if (res.ok && json.success) {
        const list: GroupSummary[] = json.data || [];
        setGroups(list);
        if (list.length > 0) {
          setSelectedGroupId((prev) => {
            if (prev && list.some((g) => g.id === prev)) return prev;
            return list[0].id;
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch groups:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!ignore) {
        await fetchGroups();
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [fetchGroups]);

  // Fetch selected group details
  const fetchGroupDetails = useCallback(async (groupId: string, activePeriod: string) => {
    setDetailsLoading(true);
    try {
      const res = await fetch(`/api/groups/${groupId}?period=${activePeriod}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setSelectedGroupDetails(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch group details:', err);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (selectedGroupId && !ignore) {
        await fetchGroupDetails(selectedGroupId, period);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [selectedGroupId, period, fetchGroupDetails]);

  // Fetch member prayer history for read-only modal
  const fetchMemberHistory = useCallback(
    async (groupId: string, memberId: string, year: number, month: number) => {
      setHistoryLoading(true);
      try {
        const mStr = String(month + 1).padStart(2, '0');
        const start = `${year}-${mStr}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const end = `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`;

        let res = await fetch(
          `/api/groups/${groupId}/members/${memberId}/prayers?startDate=${start}&endDate=${end}`
        );
        if (!res.ok) {
          res = await fetch(
            `/api/groups/${groupId}/member-history?memberId=${memberId}&startDate=${start}&endDate=${end}`
          );
        }

        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            const map: Record<string, PrayerHistoryRecord> = {};
            const recs = json.data.records || [];
            for (const r of recs) {
              if (r.date) {
                map[r.date] = r;
              }
            }
            setMemberRecords(map);
          }
        }
      } catch (err) {
        console.error('Failed to fetch member prayer history:', err);
      } finally {
        setHistoryLoading(false);
      }
    },
    []
  );

  const handleOpenMemberHistory = (member: GroupMemberRanking) => {
    const today = new Date();
    setHistoryMember(member);
    setHistoryDate(today.toISOString().split('T')[0]);
    setHistoryYear(today.getFullYear());
    setHistoryMonth(today.getMonth());
    if (selectedGroupId) {
      fetchMemberHistory(selectedGroupId, member.userId, today.getFullYear(), today.getMonth());
    }
  };

  const handleCloseMemberHistory = () => {
    setHistoryMember(null);
    setMemberRecords({});
  };

  // Handle Create Circle
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;

    setActionLoading(true);
    setActionError(null);

    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName.trim(),
          description: newGroupDescription.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setActionError(json.error || t.groups.failedCreate);
        setActionLoading(false);
        return;
      }

      setNewGroupName('');
      setNewGroupDescription('');
      setShowCreateModal(false);
      await fetchGroups();
      setSelectedGroupId(json.data.id);
    } catch {
      setActionError(t.groups.networkError);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Join Circle
  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinInviteCode.trim()) return;

    setActionLoading(true);
    setActionError(null);

    try {
      const res = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteCode: joinInviteCode.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setActionError(json.error || t.groups.failedJoin);
        setActionLoading(false);
        return;
      }

      setJoinInviteCode('');
      setShowJoinModal(false);
      await fetchGroups();
      setSelectedGroupId(json.data.id);
    } catch {
      setActionError(t.groups.networkError);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Leave Circle
  const handleLeaveGroup = async (groupId: string) => {
    if (!window.confirm(t.groups.confirmLeave)) return;

    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSelectedGroupId(null);
        setSelectedGroupDetails(null);
        await fetchGroups();
      }
    } catch (err) {
      console.error('Failed to leave group:', err);
    }
  };

  // Copy invite code to clipboard
  const handleCopyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  // Modern, vibrant numerical ranking badge helper
  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 via-amber-400 to-yellow-300 text-slate-950 font-black text-xs shadow-sm shadow-amber-500/20 border border-amber-300 shrink-0">
          1st
        </span>
      );
    }
    if (rank === 2) {
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-slate-400 via-slate-300 to-slate-200 text-slate-900 font-black text-xs shadow-sm shadow-slate-400/20 border border-slate-300 shrink-0">
          2nd
        </span>
      );
    }
    if (rank === 3) {
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-700 via-amber-600 to-amber-500 text-white font-black text-xs shadow-sm shadow-amber-700/20 border border-amber-600 shrink-0">
          3rd
        </span>
      );
    }
    return (
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold text-xs border border-slate-200 dark:border-slate-700 shrink-0">
        #{rank}
      </span>
    );
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4">
          <Users className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          {t.groups.title}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">
          {t.groups.subtitle}
        </p>
        <Link
          href="/login?redirect=/leaderboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition-transform active:scale-95 shadow-sm"
        >
          <LogIn className="w-4 h-4" />
          <span>{t.auth.login.submit}</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Circle Switcher Tabs & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {groups.length > 0 ? (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full no-scrollbar">
            {groups.map((group) => {
              const isSelected = selectedGroupId === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-2 ${
                    isSelected
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{group.name}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      isSelected
                        ? 'bg-emerald-700 text-emerald-100'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    {group.memberCount}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
            {t.groups.title}
          </div>
        )}

        {/* Action Buttons: Join & Create */}
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setShowJoinModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
            <span>{t.groups.joinGroup}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-transform active:scale-95 shadow-sm cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.groups.createGroup}</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
            <Shield className="w-6 h-6" />
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-sm mb-4">
            {t.groups.noGroups}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setShowJoinModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
            >
              <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
              <span>{t.groups.joinGroup}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setShowCreateModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-transform active:scale-95 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.groups.createGroup}</span>
            </button>
          </div>
        </div>
      ) : selectedGroupDetails ? (
        <div className="space-y-6">
          {/* Group Header Banner */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  {selectedGroupDetails.name}
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-semibold">
                  {selectedGroupDetails.memberCount} {t.groups.membersCount}
                </span>
              </div>
              {selectedGroupDetails.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
                  {selectedGroupDetails.description}
                </p>
              )}
            </div>

            {/* Actions: Copy Invite Code & Leave */}
            <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
              <button
                type="button"
                onClick={() => handleCopyInviteCode(selectedGroupDetails.inviteCode)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer"
                title={t.groups.copyCode}
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{t.groups.codeCopied}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>{selectedGroupDetails.inviteCode}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleLeaveGroup(selectedGroupDetails.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/60 transition-colors cursor-pointer"
                title={t.groups.leaveGroup}
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t.groups.leaveGroup}</span>
              </button>
            </div>
          </div>

          {/* Time Period Filter Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-fit">
            {(['daily', 'weekly', 'monthly'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  period === p
                    ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>{t.leaderboard[p]}</span>
              </button>
            ))}
          </div>

          {/* Member Rankings Table */}
          {detailsLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            </div>
          ) : (
            <div className="space-y-2.5">
              {selectedGroupDetails.members.map((member) => (
                <div
                  key={member.userId}
                  onClick={() => handleOpenMemberHistory(member)}
                  title={t.groups.viewMemberHistory}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer group ${
                    member.isCurrentUser
                      ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-700/60 ring-1 ring-emerald-500/20'
                      : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500/60 dark:hover:border-emerald-600/60 shadow-2xs'
                  }`}
                >
                  {/* Left: Rank & User Info */}
                  <div className="flex items-center gap-3.5 min-w-0">
                    {getRankBadge(member.rank)}

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors truncate">
                          {member.name}
                        </span>
                        {member.isCurrentUser && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white shrink-0">
                            {t.leaderboard.youBadge}
                          </span>
                        )}
                        {member.role === 'owner' && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                            {t.groups.owner}
                          </span>
                        )}
                        {typeof member.sadaqahOwed === 'number' && member.sadaqahOwed > 0 && (
                          <span
                            title={t.accountability.title}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-900/60 shrink-0"
                          >
                            <HeartHandshake className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
                            <span>{formatCurrency(member.sadaqahOwed, lang)}</span>
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 truncate block">
                        @{member.username}
                      </span>
                    </div>
                  </div>

                  {/* Right: Score, Metrics & View History indicator */}
                  <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-right">
                    <div className="text-right">
                      <div className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                        {member.completedCount}{' '}
                        <span className="text-xs font-semibold text-slate-400">
                          / {selectedGroupDetails.maxPossible}
                        </span>
                      </div>
                      <div className="flex items-center justify-end gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>{member.onTimeCount} {t.leaderboard.onTimeCount}</span>
                        </span>
                        <span>•</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {member.consistencyPercentage}%
                        </span>
                      </div>
                    </div>

                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* Read-Only Member Prayer History Modal                                     */}
      {/* ========================================================================= */}
      {historyMember && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto"
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center shrink-0">
                  {historyMember.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 truncate">
                      {historyMember.name}
                    </h3>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/70">
                      <Shield className="w-3 h-3 text-emerald-600" />
                      <span>{t.groups.readOnlyNotice}</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">@{historyMember.username}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseMemberHistory}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title={t.common.cancel}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Scrollable Calendar */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
              <MonthlyHistoryCalendar
                selectedDate={historyDate}
                onSelectDate={(d) => setHistoryDate(d)}
                records={memberRecords}
                viewYear={historyYear}
                viewMonth={historyMonth}
                onChangeMonth={(y, m) => {
                  setHistoryYear(y);
                  setHistoryMonth(m);
                  if (selectedGroupId && historyMember) {
                    fetchMemberHistory(selectedGroupId, historyMember.userId, y, m);
                  }
                }}
                isLoading={historyLoading}
                readOnly={true}
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Circle */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.groups.createGroup}
            </h3>

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 text-xs">
                {actionError}
              </div>
            )}

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.groups.groupName}
                </label>
                <input
                  type="text"
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={t.groups.groupNamePlaceholder}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.groups.description}
                </label>
                <input
                  type="text"
                  value={newGroupDescription}
                  onChange={(e) => setNewGroupDescription(e.target.value)}
                  placeholder={t.groups.descriptionPlaceholder}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-transform active:scale-95 disabled:opacity-60 cursor-pointer"
                >
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>{t.groups.createGroup}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Join Circle */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.groups.joinGroup}
            </h3>

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 text-xs">
                {actionError}
              </div>
            )}

            <form onSubmit={handleJoinGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.groups.inviteCode}
                </label>
                <input
                  type="text"
                  required
                  value={joinInviteCode}
                  onChange={(e) => setJoinInviteCode(e.target.value.toUpperCase())}
                  placeholder={t.groups.enterInviteCode}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 font-mono tracking-wider text-sm text-slate-900 dark:text-slate-100 uppercase focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-transform active:scale-95 disabled:opacity-60 cursor-pointer"
                >
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>{t.groups.joinGroup}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
