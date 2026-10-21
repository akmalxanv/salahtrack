export type PrayerStatus = 
  | 'PENDING' 
  | 'PRAYED_ON_TIME'
  /** @deprecated Legacy status; retained for backwards compatibility with existing documents */
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
  isOvernight?: boolean;
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

export interface SinglePrayerEntry {
  status: PrayerStatus;
  prayedAt?: string;
  missedAt?: string;
  madeUpAt?: string;
  notes?: string;
  isPaid?: boolean;
  paidAt?: string;
  paidAmount?: number;
}

export interface ISinglePrayerRecord {
  status: PrayerStatus;
  prayedAt?: Date | string;
  missedAt?: Date | string;
  madeUpAt?: Date | string;
  notes?: string;
  isPaid?: boolean;
  paidAt?: Date | string;
  paidAmount?: number;
}

export interface PrayerHistoryRecord {
  _id?: string;
  date: string; // YYYY-MM-DD
  prayers: Record<PrayerId, SinglePrayerEntry>;
  finesAccrued: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccountabilityBreakdownItem {
  date: string;
  prayerId: PrayerId;
  baseAmount: number;
  overdueAmount: number;
  totalAmount: number;
  isOverdue: boolean;
  daysPassed: number;
  status?: PrayerStatus;
}

export interface OutstandingQazaItem {
  prayerRecordId?: string;
  date: string;
  prayerId: PrayerId;
  status: PrayerStatus;
  amount: number;
  isOverdue: boolean;
  daysPassed: number;
  missedAt?: string;
  madeUpAt?: string;
}

export interface PayQazaRequestItem {
  date: string;
  prayerId: PrayerId;
}

export interface PayQazaRequestBody {
  items: PayQazaRequestItem[];
  idempotencyKey?: string;
  note?: string;
  confirmedMadeUp?: boolean;
}

export interface QazaPaymentReceiptItem {
  prayerRecordId?: string;
  date: string;
  prayerId: PrayerId;
  status: PrayerStatus;
  amount: number;
  isOverdue: boolean;
}

export interface QazaPaymentReceipt {
  id: string;
  userId: string;
  items: QazaPaymentReceiptItem[];
  totalAmount: number;
  idempotencyKey?: string;
  note?: string;
  createdAt: string;
}

export interface AccountabilitySummary {
  totalOutstanding: number;
  totalMissedPrayers: number;
  totalOverduePrayers: number;
  totalPaidAmount: number;
  currency: string;
  items: AccountabilityBreakdownItem[];
}

export interface StreakData {
  current: number;
  best: number;
  lastActiveDate: string;
}

export const DEFAULT_STREAK: StreakData = {
  current: 0,
  best: 0,
  lastActiveDate: '',
};

