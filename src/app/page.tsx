import { cookies } from 'next/headers';
import HomeDashboard from '@/components/HomeDashboard';
import { PrayerItem } from '@/types/prayer';

export default async function HomePage() {
  const cookieStore = await cookies();

  // Read saved qaza count from cookies for immediate SSR rendering
  const qazaCookie = cookieStore.get('salahtrack_qaza_count')?.value;
  let initialQazaCount: number | null = null;
  if (qazaCookie !== undefined) {
    try {
      const parsed = parseInt(decodeURIComponent(qazaCookie), 10);
      if (!isNaN(parsed)) {
        initialQazaCount = parsed;
      }
    } catch {
      // ignore
    }
  }

  // Read saved prayers from cookies for immediate SSR rendering
  const prayersCookie = cookieStore.get('salahtrack_daily_prayers')?.value;
  let initialPrayers: PrayerItem[] | null = null;
  if (prayersCookie) {
    try {
      initialPrayers = JSON.parse(decodeURIComponent(prayersCookie));
    } catch {
      // ignore
    }
  }

  return (
    <HomeDashboard
      initialQazaCount={initialQazaCount}
      initialPrayers={initialPrayers}
    />
  );
}
