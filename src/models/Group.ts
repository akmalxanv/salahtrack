import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IGroupMember {
  userId: mongoose.Types.ObjectId;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}

export interface IGroupTelegram {
  chatId: number;
  title?: string;
  connectedBy: mongoose.Types.ObjectId;
  connectedAt: Date;
  language: 'uz' | 'ru' | 'en';
  city?: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface IGroup extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  creatorId: mongoose.Types.ObjectId;
  inviteCode: string;
  members: IGroupMember[];
  /** Telegram group chat this SalahTrack group posts announcements to. */
  telegram?: IGroupTelegram;
  createdAt: Date;
  updatedAt: Date;
}

const GroupMemberSchema = new Schema<IGroupMember>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const GroupSchema = new Schema<IGroup>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 200 },
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    inviteCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    members: [GroupMemberSchema],
    telegram: {
      type: new Schema<IGroupTelegram>(
        {
          chatId: { type: Number, required: true },
          title: { type: String, trim: true, maxlength: 128 },
          connectedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          connectedAt: { type: Date, default: Date.now },
          language: { type: String, enum: ['uz', 'ru', 'en'], default: 'uz' },
          city: { type: String, trim: true, maxlength: 80 },
          latitude: { type: Number, required: true, min: -90, max: 90 },
          longitude: { type: Number, required: true, min: -180, max: 180 },
          timezone: { type: String, required: true, trim: true, maxlength: 64 },
        },
        { _id: false }
      ),
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index to query all groups where a given user is a member
GroupSchema.index({ 'members.userId': 1 });

// A Telegram chat can be bound to at most one SalahTrack group
GroupSchema.index(
  { 'telegram.chatId': 1 },
  { unique: true, partialFilterExpression: { 'telegram.chatId': { $type: 'number' } } }
);

export const Group: Model<IGroup> =
  mongoose.models.Group || mongoose.model<IGroup>('Group', GroupSchema);
