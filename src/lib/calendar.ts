/**
 * SalahTrack Calendar & Temporal Calculation Engine
 * 
 * Provides robust, timezone-resilient calendar date calculations,
 * leap year validation, month grid generation, and future date boundary checks.
 */

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  dayOfMonth: number;
  month: number;
  year: number;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  isCurrentMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
}

/**
 * Determines whether a given year is a leap year according to the Gregorian calendar.
 * Rule: Year divisible by 4, except end-of-century years not divisible by 400.
 */
export function isLeapYear(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

/**
 * Returns the exact number of days in a given month (1 = January, 12 = December).
 * Properly accounts for February in leap years (29 days) vs non-leap years (28 days).
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new RangeError(`Month must be between 1 and 12, received ${month}`);
  }
  // Days per month in a standard year
  const daysMap = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return daysMap[month - 1];
}

/**
 * Pads a single or double-digit integer to two digits with leading zero.
 */
export function padZero(val: number): string {
  return String(val).padStart(2, '0');
}

/**
 * Formats year, month (1-12), and day into standard YYYY-MM-DD.
 */
export function formatDateString(year: number, month: number, day: number): string {
  return `${year}-${padZero(month)}-${padZero(day)}`;
}

/**
 * Safely parses a YYYY-MM-DD string into UTC date components without local timezone shifts.
 */
export function parseDateComponents(dateStr: string): { year: number; month: number; day: number } {
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    throw new Error(`Invalid date format, expected YYYY-MM-DD: "${dateStr}"`);
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    throw new Error(`Invalid numeric date components: "${dateStr}"`);
  }
  return { year, month, day };
}

/**
 * Validates whether targetDate is strictly in the future compared to referenceDate.
 * Both inputs formatted as YYYY-MM-DD. Defaults referenceDate to today.
 */
export function isFutureDate(targetDate: string, referenceDate?: string): boolean {
  const ref = referenceDate || getTodayUtcString();
  return targetDate > ref;
}

/**
 * Returns today's date formatted as YYYY-MM-DD in UTC.
 */
export function getTodayUtcString(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${padZero(now.getUTCMonth() + 1)}-${padZero(now.getUTCDate())}`;
}

/**
 * Calculates deterministic start and end dates for a period ('7d' | '30d') ending on selectedDate.
 * Uses Date.UTC timestamps to avoid daylight saving time (DST) 1-hour drift.
 */
export function calculatePeriodRange(
  selectedDate: string,
  period: '7d' | '30d' | 'custom',
  todayStr: string
): { startDate: string; endDate: string } {
  const { year, month, day } = parseDateComponents(selectedDate);
  const targetUtc = Date.UTC(year, month - 1, day);
  const cappedEndDate = selectedDate > todayStr ? todayStr : selectedDate;

  if (period === '7d') {
    // 7 days inclusive: selectedDate and previous 6 days
    const pastUtc = targetUtc - 6 * 24 * 60 * 60 * 1000;
    const pastDate = new Date(pastUtc);
    const startDate = `${pastDate.getUTCFullYear()}-${padZero(pastDate.getUTCMonth() + 1)}-${padZero(pastDate.getUTCDate())}`;
    return { startDate, endDate: cappedEndDate };
  }

  if (period === '30d') {
    // 30 days inclusive: selectedDate and previous 29 days
    const pastUtc = targetUtc - 29 * 24 * 60 * 60 * 1000;
    const pastDate = new Date(pastUtc);
    const startDate = `${pastDate.getUTCFullYear()}-${padZero(pastDate.getUTCMonth() + 1)}-${padZero(pastDate.getUTCDate())}`;
    return { startDate, endDate: cappedEndDate };
  }

  return { startDate: selectedDate, endDate: cappedEndDate };
}

/**
 * Generates a full month calendar grid including leading and trailing padding days.
 * Monday is the start of the week (ISO 8601).
 */
export function generateMonthGrid(
  year: number,
  month: number,
  todayStr: string
): CalendarDay[] {
  const daysInCurrentMonth = getDaysInMonth(year, month);
  
  // Day of week for 1st of month: 0 = Sun, 1 = Mon, ..., 6 = Sat
  const firstDayDate = new Date(Date.UTC(year, month - 1, 1));
  const startDayOfWeek = firstDayDate.getUTCDay(); // 0 is Sunday
  // Convert to Monday = 0, Sunday = 6
  const mondayOffset = (startDayOfWeek + 6) % 7;

  const days: CalendarDay[] = [];

  // Previous month padding
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);

  for (let i = mondayOffset - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const dateStr = formatDateString(prevYear, prevMonth, d);
    days.push({
      date: dateStr,
      dayOfMonth: d,
      month: prevMonth,
      year: prevYear,
      dayOfWeek: (days.length + 1) % 7,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      isFuture: isFutureDate(dateStr, todayStr),
    });
  }

  // Current month days
  for (let d = 1; d <= daysInCurrentMonth; d++) {
    const dateStr = formatDateString(year, month, d);
    days.push({
      date: dateStr,
      dayOfMonth: d,
      month,
      year,
      dayOfWeek: (days.length + 1) % 7,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      isFuture: isFutureDate(dateStr, todayStr),
    });
  }

  // Trailing padding to fill out complete 7-day grid weeks (up to 35 or 42 cells)
  const remainingCells = (7 - (days.length % 7)) % 7;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  for (let d = 1; d <= remainingCells; d++) {
    const dateStr = formatDateString(nextYear, nextMonth, d);
    days.push({
      date: dateStr,
      dayOfMonth: d,
      month: nextMonth,
      year: nextYear,
      dayOfWeek: (days.length + 1) % 7,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      isFuture: isFutureDate(dateStr, todayStr),
    });
  }

  return days;
}
