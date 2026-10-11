import { cookies } from 'next/headers';
import HomeDashboard from '@/components/HomeDashboard';
import { PrayerItem, StreakData } from '@/types/prayer';
import { validateStreakData } from '@/lib/streak';

function validatePrayersData(data: unknown): PrayerItem[] | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const isValid = data.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).id === 'string' &&
      typeof (item as Record<string, unknown>).status === 'string'
  );
  return isValid ? (data as PrayerItem[]) : null;
}

function validateQazaCount(parsed: number): number | null {
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.min(Math.floor(parsed), 1_000_000);
  }
  return null;
}

export default async function HomePage() {
  const cookieStore = await cookies();

  // Read saved qaza count from cookies for immediate SSR rendering
  const qazaCookie = cookieStore.get('salahtrack_qaza_count')?.value;
  let initialQazaCount: number | null = null;
  if (qazaCookie !== undefined) {
    try {
      const parsed = parseInt(decodeURIComponent(qazaCookie), 10);
      initialQazaCount = validateQazaCount(parsed);
    } catch {
      // ignore
    }
  }

  // Read saved prayers from cookies for immediate SSR rendering
  const prayersCookie = cookieStore.get('salahtrack_daily_prayers')?.value;
  let initialPrayers: PrayerItem[] | null = null;
  if (prayersCookie) {
    try {
      const raw = JSON.parse(decodeURIComponent(prayersCookie));
      initialPrayers = validatePrayersData(raw);
    } catch {
      // ignore
    }
  }

  // Read saved streak from cookies for immediate SSR rendering
  const streakCookie = cookieStore.get('salahtrack_streak')?.value;
  let initialStreak: StreakData | null = null;
  if (streakCookie) {
    try {
      const raw = JSON.parse(decodeURIComponent(streakCookie));
      initialStreak = validateStreakData(raw);
    } catch {
      // ignore
    }
  }

  return (
    <HomeDashboard
      initialQazaCount={initialQazaCount}
      initialPrayers={initialPrayers}
      initialStreak={initialStreak}
    />
  );
}
