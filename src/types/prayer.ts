export type PrayerStatus = 
  | 'PENDING' 
  | 'PRAYED_ON_TIME'
  | 'PRAYED_LATE'
  | 'MISSED' 
  | 'MADE_UP'
  | 'PRAYED'; // Backwards compatibility alias for PRAYED_ON_TIME

export type PrayerId = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export interface PrayerItem {
  id: PrayerId;
  name: string;
  time: string;
  endTime: string;
  status: PrayerStatus;
  updatedAt?: string;
}

export interface AccountabilitySettings {
  baseFineTiyin: number;       // 15,000 UZS in tiyin (1,500,000) or whole 15000 UZS
  gracePeriodDays: number;     // 7 days
  overdueFineTiyin: number;    // +15,000 UZS in tiyin (1,500,000) or whole 15000 UZS
  currency: string;            // 'UZS'
  isEnabled: boolean;
}

export interface DailyPrayerRecord {
  date: string; // YYYY-MM-DD
  prayers: Record<PrayerId, PrayerStatus>;
  notes?: string;
}
