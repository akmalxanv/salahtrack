'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Users,
  Plus,
  Copy,
  Check,
  LogOut,
  Medal,
  Clock,
  KeyRound,
  Shield,
  Loader2,
  LogIn,
  ChevronRight,
  ArrowLeft,
  Calendar,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';

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
  const { t } = useLanguage();
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
        setGroups(json.data || []);
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
        setActionError(json.error || 'Failed to create group');
        setActionLoading(false);
        return;
      }

      setNewGroupName('');
      setNewGroupDescription('');
      setShowCreateModal(false);
      await fetchGroups();
      setSelectedGroupId(json.data.id);
    } catch {
      setActionError('Network error while creating group');
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
        setActionError(json.error || 'Failed to join group');
        setActionLoading(false);
        return;
      }

      setJoinInviteCode('');
      setShowJoinModal(false);
      await fetchGroups();
      setSelectedGroupId(json.data.id);
    } catch {
      setActionError('Network error while joining group');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Leave Circle
  const handleLeaveGroup = async (groupId: string) => {
    if (!window.confirm('Are you sure you want to leave this circle?')) return;

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

  // View: Single Group Details & Member Rankings
  if (selectedGroupId && selectedGroupDetails) {
    return (
      <div className="space-y-6">
        {/* Back navigation & group header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedGroupId(null);
                setSelectedGroupDetails(null);
              }}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Back to my circles"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>{selectedGroupDetails.name}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-semibold">
                  {selectedGroupDetails.memberCount} {t.groups.membersCount}
                </span>
              </h2>
              {selectedGroupDetails.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {selectedGroupDetails.description}
                </p>
              )}
            </div>
          </div>

          {/* Action buttons: Copy Invite Code & Leave */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => handleCopyInviteCode(selectedGroupDetails.inviteCode)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer"
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
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                  member.isCurrentUser
                    ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-700/60 ring-1 ring-emerald-500/20'
                    : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs'
                }`}
              >
                {/* Left: Rank & User Info */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-bold text-sm">
                    {member.rank === 1 ? (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                        <Medal className="w-5 h-5 fill-amber-400 stroke-amber-600" />
                      </span>
                    ) : member.rank === 2 ? (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <Medal className="w-5 h-5 fill-slate-300 stroke-slate-500" />
                      </span>
                    ) : member.rank === 3 ? (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-900/10 text-amber-700 dark:bg-amber-950/40 dark:text-amber-500">
                        <Medal className="w-5 h-5 fill-amber-700/60 stroke-amber-700" />
                      </span>
                    ) : (
                      <span className="text-slate-400 font-semibold">{member.rank}</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                        {member.name}
                      </span>
                      {member.isCurrentUser && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white">
                          {t.leaderboard.youBadge}
                        </span>
                      )}
                      {member.role === 'owner' && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {t.groups.owner}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 truncate block">
                      @{member.username}
                    </span>
                  </div>
                </div>

                {/* Right: Score & On-time */}
                <div className="text-right shrink-0">
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
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // View: Circles List
  return (
    <div className="space-y-6">
      {/* Action Header: Create & Join Circle Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span>{t.groups.title}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t.groups.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setShowJoinModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs cursor-pointer"
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

      {/* Circles List Cards */}
      {loading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
            <Shield className="w-6 h-6" />
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-sm">
            {t.groups.noGroups}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map((group) => (
            <div
              key={group.id}
              onClick={() => setSelectedGroupId(group.id)}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-emerald-500/60 dark:hover:border-emerald-600/60 transition-all cursor-pointer shadow-2xs flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 transition-colors">
                    {group.name}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold shrink-0">
                    {group.memberCount} {t.groups.membersCount}
                  </span>
                </div>

                {group.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    {group.description}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-400">
                <span className="font-mono bg-slate-50 dark:bg-slate-800/60 px-2 py-1 rounded-md text-emerald-700 dark:text-emerald-400 font-semibold">
                  {group.inviteCode}
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold group-hover:translate-x-0.5 transition-transform">
                  <span>View</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
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
                  placeholder="e.g. Monthly prayer accountability circle"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-transform active:scale-95 disabled:opacity-60"
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
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-transform active:scale-95 disabled:opacity-60"
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
