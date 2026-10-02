import mongoose from 'mongoose';

if (typeof window !== 'undefined') {
  throw new Error('connectDB can only be executed on the server.');
}

/**
 * Global cache interface for Mongoose to prevent connection exhaustion
 * in serverless environments and during Next.js hot module reloads.
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongooseCache || { conn: null, promise: null };

if (!global.mongooseCache) {
  global.mongooseCache = cached;
}

/**
 * Singleton database connection helper for MongoDB Atlas.
 * Caches the connection across serverless invocations and hot-reloads.
 */
export async function connectDB(): Promise<typeof mongoose> {
  const currentCache = global.mongooseCache || cached;
  if (currentCache.conn) {
    return currentCache.conn;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    };

    cached.promise = mongoose.connect(uri, opts).then((mongooseInstance) => {
      return mongooseInstance;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    cached.promise = null;
    cached.conn = null;
    const err = error as Error & { code?: string | number };
    console.error('[MongoDB Connection Error]:', {
      name: err.name || 'Error',
      message: err.message,
      code: err.code,
    });
    throw error;
  }

  return cached.conn;
}

export const connectToDatabase = connectDB;
export default connectDB;
