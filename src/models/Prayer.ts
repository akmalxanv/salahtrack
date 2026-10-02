import mongoose, { Schema, Document, Model } from 'mongoose';
import type { PrayerStatus, PrayerId } from '@/types/prayer';

export interface ISinglePrayerRecord {
  status: PrayerStatus;
  prayedAt?: Date;
  missedAt?: Date;
  madeUpAt?: Date;
  notes?: string;
}

export interface IPrayerRecord extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD
  prayers: Record<PrayerId, ISinglePrayerRecord>;
  finesAccrued: number; // in whole UZS (e.g. 15,000 or 30,000)
  createdAt: Date;
  updatedAt: Date;
}

const SinglePrayerSchema = new Schema<ISinglePrayerRecord>(
  {
    status: {
      type: String,
      enum: ['PENDING', 'PRAYED_ON_TIME', 'PRAYED_LATE', 'MISSED', 'MADE_UP', 'PRAYED'],
      default: 'PENDING',
      required: true,
    },
    prayedAt: { type: Date },
    missedAt: { type: Date },
    madeUpAt: { type: Date },
    notes: { type: String, maxlength: 200 },
  },
  { _id: false }
);

const PrayerRecordSchema = new Schema<IPrayerRecord>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    prayers: {
      fajr: { type: SinglePrayerSchema, default: () => ({ status: 'PENDING' }) },
      dhuhr: { type: SinglePrayerSchema, default: () => ({ status: 'PENDING' }) },
      asr: { type: SinglePrayerSchema, default: () => ({ status: 'PENDING' }) },
      maghrib: { type: SinglePrayerSchema, default: () => ({ status: 'PENDING' }) },
      isha: { type: SinglePrayerSchema, default: () => ({ status: 'PENDING' }) },
    },
    finesAccrued: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound unique index: guarantees exactly one daily document per user per calendar day
PrayerRecordSchema.index({ userId: 1, date: 1 }, { unique: true });

// Time-series query optimization for history and statistics range lookups
PrayerRecordSchema.index({ userId: 1, date: -1 });

export const PrayerRecord: Model<IPrayerRecord> =
  (mongoose.models && mongoose.models.PrayerRecord) ||
  mongoose.model<IPrayerRecord>('PrayerRecord', PrayerRecordSchema);
