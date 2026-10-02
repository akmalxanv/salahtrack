/**
 * Authentication Input Validation & Sanitization Module
 *
 * Provides strict validation and normalization for user credentials, email addresses,
 * usernames, and authentication payloads. Used both by the Backend Agent for Route
 * Handler payload security and by the Frontend Agent for live form validation feedback.
 */

export interface ValidationResult<T> {
  isValid: boolean;
  errors: Record<string, string>;
  data?: T;
}

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Standard Email Regex matching RFC 5322 specifications while avoiding catastrophic backtracking.
 */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Username constraints:
 * - 3 to 30 characters
 * - Only alphanumeric characters and underscores
 */
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

/**
 * Validates whether an email string meets standard format and length constraints.
 */
export function isValidEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Normalizes an email string to trimmed lowercase.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validates whether a username meets character, length, and format requirements.
 */
export function isValidUsername(username: unknown): boolean {
  if (typeof username !== 'string') return false;
  const trimmed = username.trim();
  return USERNAME_REGEX.test(trimmed);
}

/**
 * Normalizes a username string to trimmed lowercase.
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Validates password complexity against the security specification:
 * - Minimum 8 characters
 * - Maximum 128 characters (DoS mitigation)
 * - At least one lowercase letter
 * - At least one uppercase letter
 * - At least one digit
 * - At least one special symbol
 */
export function validatePassword(password: unknown): PasswordValidationResult {
  const errors: string[] = [];

  if (typeof password !== 'string') {
    return { isValid: false, errors: ['Password must be a valid string'] };
  }

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (password.length > 128) {
    errors.push('Password must not exceed 128 characters');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one digit (0-9)');
  }

  if (!/[^a-zA-Z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Signup Payload Validation
 */
export interface SignupInput {
  name: string;
  email: string;
  username: string;
  password: string;
  confirmPassword?: string;
}

export function validateSignupPayload(payload: unknown): ValidationResult<Omit<SignupInput, 'confirmPassword'>> {
  const errors: Record<string, string> = {};

  if (!payload || typeof payload !== 'object') {
    return { isValid: false, errors: { form: 'Invalid request body' } };
  }

  const raw = payload as Record<string, unknown>;

  // 1. Name validation
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length < 2) {
    errors.name = 'Name must be at least 2 characters';
  } else if (name.length > 50) {
    errors.name = 'Name must not exceed 50 characters';
  }

  // 2. Email validation
  if (!isValidEmail(raw.email)) {
    errors.email = 'Please provide a valid email address';
  }

  // 3. Username validation
  if (!isValidUsername(raw.username)) {
    errors.username = 'Username must be 3-30 characters and contain only letters, numbers, and underscores';
  }

  // 4. Password validation
  const passwordResult = validatePassword(raw.password);
  if (!passwordResult.isValid) {
    errors.password = passwordResult.errors[0];
  }

  // 5. Password confirmation check
  if (typeof raw.confirmPassword === 'string' && raw.password !== raw.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match';
  }

  if (Object.keys(errors).length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: {},
    data: {
      name,
      email: normalizeEmail(raw.email as string),
      username: normalizeUsername(raw.username as string),
      password: raw.password as string,
    },
  };
}

/**
 * Login Payload Validation
 */
export interface LoginInput {
  identifier: string; // Accepts either username or email
  password: string;
  rememberMe: boolean;
}

export function validateLoginPayload(payload: unknown): ValidationResult<LoginInput> {
  const errors: Record<string, string> = {};

  if (!payload || typeof payload !== 'object') {
    return { isValid: false, errors: { form: 'Invalid request body' } };
  }

  const raw = payload as Record<string, unknown>;

  const identifier = typeof raw.identifier === 'string' ? raw.identifier.trim() : '';
  if (!identifier || identifier.length < 3) {
    errors.identifier = 'Please provide your email or username';
  } else if (identifier.length > 254) {
    errors.identifier = 'Identifier exceeds maximum allowed length';
  }

  const password = typeof raw.password === 'string' ? raw.password : '';
  if (!password) {
    errors.password = 'Please provide your password';
  }

  if (Object.keys(errors).length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: {},
    data: {
      identifier: identifier.toLowerCase(),
      password,
      rememberMe: Boolean(raw.rememberMe),
    },
  };
}

/**
 * Forgot Password Payload Validation
 */
export interface ForgotPasswordInput {
  email: string;
}

export function validateForgotPasswordPayload(payload: unknown): ValidationResult<ForgotPasswordInput> {
  const errors: Record<string, string> = {};

  if (!payload || typeof payload !== 'object') {
    return { isValid: false, errors: { form: 'Invalid request body' } };
  }

  const raw = payload as Record<string, unknown>;

  if (!isValidEmail(raw.email)) {
    errors.email = 'Please provide a valid email address';
  }

  if (Object.keys(errors).length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: {},
    data: {
      email: normalizeEmail(raw.email as string),
    },
  };
}

/**
 * Reset Password Payload Validation
 */
export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export function validateResetPasswordPayload(payload: unknown): ValidationResult<ResetPasswordInput> {
  const errors: Record<string, string> = {};

  if (!payload || typeof payload !== 'object') {
    return { isValid: false, errors: { form: 'Invalid request body' } };
  }

  const raw = payload as Record<string, unknown>;

  // Token validation (hexadecimal token generated by node:crypto)
  const token = typeof raw.token === 'string' ? raw.token.trim() : '';
  if (!token || !/^[a-f0-9]{32,128}$/i.test(token)) {
    errors.token = 'Invalid or malformed password reset token';
  }

  // Password validation
  const passwordResult = validatePassword(raw.newPassword);
  if (!passwordResult.isValid) {
    errors.newPassword = passwordResult.errors[0];
  }

  // Password confirmation check
  if (typeof raw.confirmPassword === 'string' && raw.newPassword !== raw.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match';
  }

  if (Object.keys(errors).length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: {},
    data: {
      token,
      newPassword: raw.newPassword as string,
    },
  };
}
