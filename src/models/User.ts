import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  username: string;
  passwordHash: string;
  role: 'user' | 'admin';
  preferences: {
    language: 'uz' | 'ru' | 'en';
    calculationMethod?: string;
    showOnLeaderboard?: boolean;
  };
  passwordResetTokenHash?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // Never included in default queries
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    preferences: {
      language: {
        type: String,
        enum: ['uz', 'ru', 'en'],
        default: 'uz',
      },
      calculationMethod: {
        type: String,
        default: 'MWL',
      },
      showOnLeaderboard: {
        type: Boolean,
        default: false,
      },
    },
    passwordResetTokenHash: {
      type: String,
      select: false, // Never included in default queries
    },
    passwordResetExpires: {
      type: Date,
      select: false, // Never included in default queries
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        delete ret.passwordResetTokenHash;
        delete ret.passwordResetExpires;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const User: Model<IUser> =
  (mongoose.models && mongoose.models.User) || mongoose.model<IUser>('User', UserSchema);
