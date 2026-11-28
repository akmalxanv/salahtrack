import { NextResponse } from 'next/server.js';
import { connectDB } from '../../../lib/mongodb.ts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Verifies MongoDB Atlas connectivity and reports connection state and ping latency.
 */
export async function GET() {
  const start = Date.now();
  try {
    const conn = await connectDB();
    const db = conn?.connection?.db;
    if (!db || typeof db.admin !== 'function') {
      throw new Error('Database handle unavailable');
    }

    await db.admin().ping();
    const latencyMs = Date.now() - start;
    const readyState = conn.connection.readyState;

    return NextResponse.json(
      {
        success: true,
        data: {
          status: 'ok',
          readyState,
          latencyMs,
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    const err = error as Error & { code?: string | number };
    console.error('Health check failed:', {
      name: err?.name || 'Error',
      code: err?.code,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Database unavailable',
        code: 'DB_UNAVAILABLE',
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  }
}
