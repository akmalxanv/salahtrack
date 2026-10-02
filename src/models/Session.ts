import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISession extends Document {
  _id: mongoose.Types.ObjectId;
  sessionToken: string;
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    sessionToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      // Native MongoDB TTL index: automatically purges expired session documents
      expires: 0,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
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

export const Session: Model<ISession> =
  (mongoose.models && mongoose.models.Session) || mongoose.model<ISession>('Session', SessionSchema);
