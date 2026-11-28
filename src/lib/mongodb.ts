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

function getCache(): MongooseCache {
  if (!global.mongooseCache) {
    global.mongooseCache = { conn: null, promise: null };
  }
  return global.mongooseCache;
}

// Initialize the global cache on module load so callers/tests inspecting global.mongooseCache see it immediately
getCache();

/**
 * Singleton database connection helper for MongoDB Atlas.
 * Caches the connection across serverless invocations and hot-reloads.
 */
export async function connectDB(): Promise<typeof mongoose> {
  const cache = getCache();
  if (cache.conn) {
    return cache.conn;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
  }

  if (!cache.promise) {
    const dbName = process.env.MONGODB_DB_NAME?.trim();
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 20000,
      maxPoolSize: 10,
      ...(dbName ? { dbName } : {}),
    };

    cache.promise = mongoose.connect(uri, opts).then((mongooseInstance) => {
      return mongooseInstance;
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    cache.promise = null;
    cache.conn = null;
    const err = error as Error & { code?: string | number };
    const safeMessage =
      typeof err?.message === 'string'
        ? err.message.replace(/\/\/([^:]+):([^@]+)@/g, '//***:***@')
        : 'Unknown connection error';
    console.error('[MongoDB Connection Error]:', {
      name: err?.name || 'Error',
      message: safeMessage,
      code: err?.code,
    });
    throw error;
  }

  return cache.conn;
}

/**
 * Safely executes a Mongoose query with .lean() in production while
 * gracefully falling back to awaiting the raw promise in test mocks.
 */
export async function execLean<T>(queryOrPromise: unknown): Promise<T> {
  const q = queryOrPromise as { lean?: () => Promise<T> };
  if (q && typeof q.lean === 'function') {
    return await q.lean();
  }
  return (await (queryOrPromise as Promise<T>));
}

export const connectToDatabase = connectDB;
export default connectDB;
