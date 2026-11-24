import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Delivery ledger for scheduled Telegram announcements.
 *
 * The cron endpoint runs every few minutes, and two runs can overlap. Before sending,
 * the notifier inserts a document with a deterministic `key`
 * (`<groupId>:<YYYY-MM-DD>:<eventId>`). The unique index makes that insert an atomic
 * "claim": only the run whose insert succeeds sends the message. A TTL index removes
 * old claims after 14 days.
 */
export interface ITelegramNotification extends Document {
  key: string;
  groupId: mongoose.Types.ObjectId;
  sentAt: Date;
}

const TelegramNotificationSchema = new Schema<ITelegramNotification>({
  key: { type: String, required: true, unique: true, maxlength: 128 },
  groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
  sentAt: { type: Date, default: Date.now, expires: 14 * 24 * 60 * 60 },
});

export const TelegramNotification: Model<ITelegramNotification> =
  (mongoose.models && mongoose.models.TelegramNotification) ||
  mongoose.model<ITelegramNotification>('TelegramNotification', TelegramNotificationSchema);
