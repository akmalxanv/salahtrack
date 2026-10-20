import { NextResponse, type NextRequest } from 'next/server';

const ALLOWED_LANGUAGES = new Set(['uz', 'ru', 'en']);
const STORAGE_KEY = 'namozlarim_lang';
const FALLBACK_STORAGE_KEY = 'salahtrack_lang';

/**
 * Next.js Edge Middleware for SalahTrack
 *
 * Security Functions:
 * 1. Sanitizes incoming language cookies against path traversal, prototype pollution, and arbitrary injection.
 * 2. Validates ?lang= query parameters against strict allowlist before updating cookies.
 * 3. Enforces SameSite=Lax, Path=/, 1-year maxAge, and Secure (in production) on locale cookies.
 */
export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Bypass internal static Next.js assets, images, and public files
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const isProd = process.env.NODE_ENV === 'production';

  const cookieOptions = {
    path: '/',
    maxAge: 31536000,
    sameSite: 'lax' as const,
    secure: isProd,
    httpOnly: false,
  };

  // 1. Audit and sanitize incoming cookies
  const primaryCookie = request.cookies.get(STORAGE_KEY)?.value;
  const fallbackCookie = request.cookies.get(FALLBACK_STORAGE_KEY)?.value;

  if (primaryCookie && !ALLOWED_LANGUAGES.has(primaryCookie)) {
    response.cookies.set(STORAGE_KEY, 'uz', cookieOptions);
  }
  if (fallbackCookie && !ALLOWED_LANGUAGES.has(fallbackCookie)) {
    response.cookies.set(FALLBACK_STORAGE_KEY, 'uz', cookieOptions);
  }

  // 2. Validate and synchronize ?lang= query parameter
  const langParam = searchParams.get('lang');
  if (langParam) {
    const cleanLang = langParam.trim().toLowerCase();
    if (ALLOWED_LANGUAGES.has(cleanLang)) {
      response.cookies.set(STORAGE_KEY, cleanLang, cookieOptions);
      response.cookies.set(FALLBACK_STORAGE_KEY, cleanLang, cookieOptions);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
