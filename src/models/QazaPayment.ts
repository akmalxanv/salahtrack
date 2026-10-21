import mongoose, { Schema, Document, Model } from 'mongoose';
import type { PrayerId, PrayerStatus } from '../types/prayer.ts';

export interface IQazaPaymentItem {
  prayerRecordId?: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD
  prayerId: PrayerId;
  status: PrayerStatus; // 'MISSED' | 'MADE_UP'
  amount: number; // in whole UZS (e.g. 15,000 or 30,000)
  isOverdue: boolean;
}

export interface IQazaPayment extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  items: IQazaPaymentItem[];
  totalAmount: number; // in whole UZS
  idempotencyKey?: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const QazaPaymentItemSchema = new Schema<IQazaPaymentItem>(
  {
    prayerRecordId: {
      type: Schema.Types.ObjectId,
      ref: 'PrayerRecord',
    },
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    prayerId: {
      type: String,
      required: true,
      enum: ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'],
    },
    status: {
      type: String,
      required: true,
      enum: ['MISSED', 'MADE_UP'],
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    isOverdue: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { _id: false }
);

const QazaPaymentSchema = new Schema<IQazaPayment>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: {
      type: [QazaPaymentItemSchema],
      required: true,
      validate: {
        validator: (items: IQazaPaymentItem[]) => Array.isArray(items) && items.length > 0,
        message: 'Payment must include at least one prayer item',
      },
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 128,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 300,
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

// Compound index for user payment history queries
QazaPaymentSchema.index({ userId: 1, createdAt: -1 });

// Compound unique index for user-scoped idempotency keys (prevents cross-user collisions and duplicate replay)
QazaPaymentSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);

export const QazaPayment: Model<IQazaPayment> =
  (mongoose.models && mongoose.models.QazaPayment) ||
  mongoose.model<IQazaPayment>('QazaPayment', QazaPaymentSchema);
