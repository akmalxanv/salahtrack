import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IGroupMember {
  userId: mongoose.Types.ObjectId;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}

export interface IGroup extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  creatorId: mongoose.Types.ObjectId;
  inviteCode: string;
  members: IGroupMember[];
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
  },
  {
    timestamps: true,
  }
);

// Index to query all groups where a given user is a member
GroupSchema.index({ 'members.userId': 1 });

export const Group: Model<IGroup> =
  mongoose.models.Group || mongoose.model<IGroup>('Group', GroupSchema);
