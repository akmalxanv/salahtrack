export type PrayerStatus = 
  | 'PENDING' 
  | 'PRAYED_ON_TIME' 
  | 'PRAYED_LATE' 
  | 'MISSED' 
  | 'MADE_UP';

export type PrayerName = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha';

export interface PrayerItem {
  id: string;
  name: PrayerName;
  time: string;
  status: PrayerStatus;
}
