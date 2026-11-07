import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { User } from '../../../../models/User.ts';
import { authenticateRequest, sanitizeUser } from '../../../../lib/auth/index.ts';
import {
  consumeRateLimit,
  createRateLimitKey,
  DEFAULT_PROFILE_RATE_LIMIT,
} from '../../../../lib/auth/rate-limit.ts';
import { sanitizeLocationName } from '../../../../lib/qibla.ts';
import {
  isValidLanguage,
  STORAGE_KEY,
  FALLBACK_STORAGE_KEY,
} from '../../../../locales/translations.ts';

const VALID_CALCULATION_METHODS = new Set([
  'MWL',
  'ISNA',
  'EGYPT',
  'MAKKAH',
  'KARACHI',
  'TEHRAN',
  'GULF',
  'KUWAIT',
  'QATAR',
  'SINGAPORE',
  'FRANCE',
  'TURKEY',
  'RUSSIA',
]);

const TIMEZONE_REGEX = /^[a-zA-Z0-9_\-\+/]{1,50}$/;

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
 * Enforces server-side authorization: users may ONLY modify their own profile (auth.user.id).
 * Implements strict input sanitization and validation on all editable fields.
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
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
    if (body.name !== undefined) {
      if (typeof body.name !== 'string') {
        return NextResponse.json(
          { success: false, error: 'Name must be a valid string', code: 'VALIDATION_FAILED' },
          { status: 400 }
        );
      }
      // Strip control characters and HTML tags, then trim
      const sanitizedName = body.name.replace(/[\x00-\x1F\x7F<>]/g, '').trim();
      if (sanitizedName.length >= 2 && sanitizedName.length <= 50) {
        user.name = sanitizedName;
      } else {
        return NextResponse.json(
          { success: false, error: 'Name must be between 2 and 50 characters', code: 'VALIDATION_FAILED' },
          { status: 400 }
        );
      }
    }

    let languageUpdated: 'uz' | 'ru' | 'en' | null = null;

    // 3. Update Preferences if provided
    if (body.preferences !== undefined) {
      if (typeof body.preferences !== 'object' || body.preferences === null || Array.isArray(body.preferences)) {
        return NextResponse.json(
          { success: false, error: 'Preferences must be a valid object', code: 'VALIDATION_FAILED' },
          { status: 400 }
        );
      }

      const {
        language,
        calculationMethod,
        showOnLeaderboard,
        city,
        latitude,
        longitude,
        timezone,
      } = body.preferences as Record<string, unknown>;

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

      if (calculationMethod !== undefined) {
        if (calculationMethod === null || calculationMethod === '') {
          user.preferences.calculationMethod = 'MWL';
        } else if (typeof calculationMethod === 'string') {
          const upper = calculationMethod.trim().toUpperCase();
          const isKnownMethod = VALID_CALCULATION_METHODS.has(upper);
          const isNumeric = /^\d{1,2}$/.test(upper) && parseInt(upper, 10) >= 0 && parseInt(upper, 10) <= 25;
          if (isKnownMethod || isNumeric) {
            user.preferences.calculationMethod = calculationMethod.trim().slice(0, 30);
          } else {
            return NextResponse.json(
              { success: false, error: 'Invalid calculation method', code: 'INVALID_CALCULATION_METHOD' },
              { status: 400 }
            );
          }
        } else {
          return NextResponse.json(
            { success: false, error: 'Calculation method must be a string', code: 'INVALID_CALCULATION_METHOD' },
            { status: 400 }
          );
        }
      }

      if (showOnLeaderboard !== undefined) {
        if (typeof showOnLeaderboard === 'boolean') {
          user.preferences.showOnLeaderboard = showOnLeaderboard;
        } else {
          return NextResponse.json(
            { success: false, error: 'showOnLeaderboard must be a boolean', code: 'VALIDATION_FAILED' },
            { status: 400 }
          );
        }
      }

      if (city !== undefined) {
        if (city === null || city === '') {
          user.preferences.city = undefined;
        } else if (typeof city === 'string') {
          const sanitizedCity = sanitizeLocationName(city);
          user.preferences.city = sanitizedCity || undefined;
        } else {
          return NextResponse.json(
            { success: false, error: 'City must be a valid string or null', code: 'INVALID_CITY' },
            { status: 400 }
          );
        }
      }

      if (latitude !== undefined) {
        if (latitude === null) {
          user.preferences.latitude = undefined;
        } else if (typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90) {
          user.preferences.latitude = Math.round(latitude * 1000000) / 1000000;
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
          user.preferences.longitude = Math.round(longitude * 1000000) / 1000000;
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
          if (TIMEZONE_REGEX.test(trimmedTz)) {
            user.preferences.timezone = trimmedTz;
          } else {
            return NextResponse.json(
              { success: false, error: 'Timezone must be a valid IANA timezone string (max 50 chars)', code: 'INVALID_TIMEZONE' },
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
