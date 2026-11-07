import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { User } from '../../../../models/User.ts';
import { authenticateRequest, sanitizeUser } from '../../../../lib/auth/index.ts';
import {
  consumeRateLimit,
  createRateLimitKey,
  DEFAULT_PROFILE_RATE_LIMIT,
} from '../../../../lib/auth/rate-limit.ts';
import {
  isValidLanguage,
  STORAGE_KEY,
  FALLBACK_STORAGE_KEY,
} from '../../../../locales/translations.ts';

/**
 * GET /api/user/profile
 * Retrieves the currently authenticated user's private profile.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required', code: 'AUTH_UNAUTHORIZED' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: { user: auth.user },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET /api/user/profile:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/profile
 * Updates the authenticated user's personal details and preferences.
 * Enforces server-side authorization: users may ONLY modify their own profile.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required', code: 'AUTH_UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // 1. Sliding-window rate limit guard (Mitigates profile mutation spamming & resource exhaustion)
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
    const rateLimitKey = createRateLimitKey(ipAddress, `profile:${auth.user.id}`);
    const rateCheck = consumeRateLimit(rateLimitKey, DEFAULT_PROFILE_RATE_LIMIT);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many profile update requests. Please wait a moment before trying again.',
          code: 'AUTH_RATE_LIMITED',
          retryAfterSeconds: rateCheck.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.retryAfterSeconds),
          },
        }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request payload', code: 'VALIDATION_FAILED' },
        { status: 400 }
      );
    }

    await connectDB();

    const user = await User.findById(auth.user.id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found', code: 'USER_NOT_FOUND' },
        { status: 404 }
      );
    }

    // 2. Update Full Name if provided
    if (typeof body.name === 'string') {
      const trimmedName = body.name.trim();
      if (trimmedName.length >= 2 && trimmedName.length <= 50) {
        user.name = trimmedName;
      } else {
        return NextResponse.json(
          { success: false, error: 'Name must be between 2 and 50 characters', code: 'VALIDATION_FAILED' },
          { status: 400 }
        );
      }
    }

    let languageUpdated: 'uz' | 'ru' | 'en' | null = null;

    // 3. Update Preferences if provided
    if (body.preferences && typeof body.preferences === 'object') {
      const {
        language,
        calculationMethod,
        showOnLeaderboard,
        city,
        latitude,
        longitude,
        timezone,
      } = body.preferences as {
        language?: unknown;
        calculationMethod?: unknown;
        showOnLeaderboard?: unknown;
        city?: unknown;
        latitude?: unknown;
        longitude?: unknown;
        timezone?: unknown;
      };

      if (language !== undefined) {
        if (isValidLanguage(language)) {
          user.preferences.language = language;
          languageUpdated = language;
        } else {
          return NextResponse.json(
            { success: false, error: 'Invalid language preference. Allowed: uz, ru, en', code: 'INVALID_LANGUAGE' },
            { status: 400 }
          );
        }
      }

      if (calculationMethod && typeof calculationMethod === 'string') {
        user.preferences.calculationMethod = calculationMethod;
      }

      if (typeof showOnLeaderboard === 'boolean') {
        user.preferences.showOnLeaderboard = showOnLeaderboard;
      }

      if (city !== undefined) {
        if (city === null || city === '') {
          user.preferences.city = undefined;
        } else if (typeof city === 'string') {
          user.preferences.city = city.trim().slice(0, 100);
        }
      }

      if (latitude !== undefined) {
        if (latitude === null) {
          user.preferences.latitude = undefined;
        } else if (typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90) {
          user.preferences.latitude = latitude;
        } else {
          return NextResponse.json(
            { success: false, error: 'Latitude must be a valid number between -90 and 90', code: 'INVALID_LATITUDE' },
            { status: 400 }
          );
        }
      }

      if (longitude !== undefined) {
        if (longitude === null) {
          user.preferences.longitude = undefined;
        } else if (typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
          user.preferences.longitude = longitude;
        } else {
          return NextResponse.json(
            { success: false, error: 'Longitude must be a valid number between -180 and 180', code: 'INVALID_LONGITUDE' },
            { status: 400 }
          );
        }
      }

      if (timezone !== undefined) {
        if (timezone === null || timezone === '') {
          user.preferences.timezone = undefined;
        } else if (typeof timezone === 'string') {
          const trimmedTz = timezone.trim();
          if (trimmedTz.length <= 50) {
            user.preferences.timezone = trimmedTz;
          } else {
            return NextResponse.json(
              { success: false, error: 'Timezone must not exceed 50 characters', code: 'INVALID_TIMEZONE' },
              { status: 400 }
            );
          }
        } else {
          return NextResponse.json(
            { success: false, error: 'Timezone must be a valid string', code: 'INVALID_TIMEZONE' },
            { status: 400 }
          );
        }
      }
    }

    await user.save();

    const updatedSafeUser = sanitizeUser(user);
    const response = NextResponse.json(
      {
        success: true,
        data: { user: updatedSafeUser },
        message: 'Profile updated successfully',
      },
      { status: 200 }
    );

    // Synchronize client SSR cookies if language was updated
    if (languageUpdated) {
      const isProd = process.env.NODE_ENV === 'production';
      const cookieOpts = {
        path: '/',
        maxAge: 31536000,
        sameSite: 'lax' as const,
        secure: isProd,
        httpOnly: false,
      };
      response.cookies.set(STORAGE_KEY, languageUpdated, cookieOpts);
      response.cookies.set(FALLBACK_STORAGE_KEY, languageUpdated, cookieOpts);
    }

    return response;
  } catch (error) {
    console.error('Error in PUT /api/user/profile:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred while updating profile' },
      { status: 500 }
    );
  }
}
