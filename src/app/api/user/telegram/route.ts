import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { User } from '../../../../models/User.ts';
import { authenticateRequest } from '../../../../lib/auth/index.ts';
import {
  consumeRateLimit,
  createRateLimitKey,
  DEFAULT_PROFILE_RATE_LIMIT,
} from '../../../../lib/auth/rate-limit.ts';
import { generateLinkCode, buildDeepLink, LINK_CODE_TTL_MS } from '../../../../lib/telegram/link.ts';

export const dynamic = 'force-dynamic';

const unauthorized = () =>
  NextResponse.json(
    { success: false, error: 'Unauthorized: Authentication required', code: 'AUTH_UNAUTHORIZED' },
    { status: 401 }
  );

/** GET /api/user/telegram — link status of the signed-in user. */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) return unauthorized();
    await connectDB();
    const user = await User.findById(auth.user.id).select('telegram').lean();
    const tg = user?.telegram;
    return NextResponse.json({
      success: true,
      data: {
        linked: typeof tg?.userId === 'number',
        username: tg?.username ?? null,
        firstName: tg?.firstName ?? null,
        linkedAt: tg?.linkedAt ?? null,
        // The website only builds deep links; the token lives on the bot server
        botConfigured: Boolean(process.env.TELEGRAM_BOT_USERNAME),
      },
    });
  } catch (error) {
    console.error('Error in GET /api/user/telegram:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/user/telegram — issues a one-time deep link (valid 15 min) that links the
 * Telegram account which opens it to the signed-in user. Only the hash is stored.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) return unauthorized();

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const limit = consumeRateLimit(createRateLimitKey(ip, `tg-link:${auth.user.id}`), DEFAULT_PROFILE_RATE_LIMIT);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    const { code, hash } = generateLinkCode();
    const deepLink = buildDeepLink(code);
    if (!deepLink) {
      return NextResponse.json(
        { success: false, error: 'Telegram bot is not configured', code: 'TELEGRAM_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    await connectDB();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await User.updateOne(
      { _id: auth.user.id },
      { $set: { telegramLinkCodeHash: hash, telegramLinkExpires: expiresAt } }
    );

    return NextResponse.json({ success: true, data: { deepLink, expiresAt } });
  } catch (error) {
    console.error('Error in POST /api/user/telegram:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

/** DELETE /api/user/telegram — unlinks Telegram (stops mentions and group reports for this user). */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) return unauthorized();
    await connectDB();
    await User.updateOne(
      { _id: auth.user.id },
      { $unset: { telegram: 1, telegramLinkCodeHash: 1, telegramLinkExpires: 1 } }
    );
    return NextResponse.json({ success: true, data: { linked: false } });
  } catch (error) {
    console.error('Error in DELETE /api/user/telegram:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
