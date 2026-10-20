/**
 * SalahTrack / Namozlarim API Contract & Machine-Readable Error Codes
 * 
 * Provides type definitions for standardized JSON API responses across all Next.js Route Handlers.
 * Eliminates brittle string matching and enables direct client-side translation via `t.apiErrors[code]`.
 */

export type ApiErrorCode =
  // Authentication & Authorization
  | 'AUTH_UNAUTHORIZED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_SESSION_EXPIRED'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_INVALID_TOKEN'

  // Input Validation & Conflicts
  | 'VALIDATION_FAILED'
  | 'DUPLICATE_EMAIL'
  | 'DUPLICATE_USERNAME'
  | 'USER_NOT_FOUND'
  | 'INVALID_CURRENT_PASSWORD'
  | 'PASSWORDS_DO_NOT_MATCH'
  | 'PASSWORD_TOO_WEAK'
  | 'INVALID_LANGUAGE'
  | 'INVALID_DATE'
  | 'FUTURE_DATE_NOT_ALLOWED'
  | 'INVALID_PRAYER_ID'
  | 'INVALID_PRAYER_STATUS'

  // Circles / Groups
  | 'CIRCLE_NOT_FOUND'
  | 'CIRCLE_ALREADY_MEMBER'
  | 'CIRCLE_NOT_MEMBER'
  | 'INVALID_INVITE_CODE'

  // Generic & Server
  | 'INTERNAL_SERVER_ERROR'
  | 'RESOURCE_NOT_FOUND';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: ApiErrorCode;
  errors?: Record<string, string>;
  message?: string;
  retryAfterSeconds?: number;
}
