import { NextRequest, NextResponse } from 'next/server.js';
import mongoose from 'mongoose';
import { connectDB } from '../../../../lib/mongodb.ts';
import { PrayerRecord, type IPrayerRecord } from '../../../../models/Prayer.ts';
import { QazaPayment } from '../../../../models/QazaPayment.ts';
import { authenticateRequest } from '../../../../lib/auth/index.ts';
import { isValidCalendarDate, sanitizeNotes } from '../route.ts';
import {
  calculateAccountabilityFines,
  calculateAuthoritativeDebt,
  calculateDaysPassed,
  isOverduePrayer,
  BASE_PLEDGE_AMOUNT,
  OVERDUE_PENALTY_AMOUNT,
} from '../../../../lib/accountability.ts';
import type {
  PrayerId,
  PrayerStatus,
  PayQazaRequestBody,
} from '../../../../types/prayer.ts';

const VALID_PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const MAX_PAYMENT_ITEMS = 500;

/**
 * GET /api/prayers/qaza-payment
 * Retrieves the authenticated user's complete Qaza fine payment history,
 * sorted by creation timestamp descending.
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

    await connectDB();

    const payments = await QazaPayment.find({
      userId: auth.user.id,
    }).sort({ createdAt: -1 });

    const formatted = payments.map((p) => ({
      id: p._id.toString(),
      userId: p.userId.toString(),
      items: p.items.map((it) => ({
        prayerRecordId: it.prayerRecordId ? it.prayerRecordId.toString() : undefined,
        date: it.date,
        prayerId: it.prayerId,
        status: it.status,
        amount: it.amount,
        isOverdue: it.isOverdue,
      })),
      totalAmount: p.totalAmount,
      idempotencyKey: p.idempotencyKey,
      note: p.note,
      createdAt: p.createdAt.toISOString(),
    }));

    return NextResponse.json(
      {
        success: true,
        data: formatted,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET /api/prayers/qaza-payment:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/prayers/qaza-payment
 * Settles outstanding Qaza fines / Sadaqah payments against specific prayer dates.
 * Enforces server-side fine calculation, double-payment prevention, and atomic ledger updates.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required', code: 'AUTH_UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const body: PayQazaRequestBody = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Valid items array with at least one prayer is required', code: 'VALIDATION_FAILED' },
        { status: 400 }
      );
    }

    if (body.items.length > MAX_PAYMENT_ITEMS) {
      return NextResponse.json(
        {
          success: false,
          error: `Payment batch exceeds maximum allowed limit of ${MAX_PAYMENT_ITEMS} items`,
          code: 'BATCH_LIMIT_EXCEEDED',
        },
        { status: 400 }
      );
    }

    // 1. Syntax & structure validation
    const seen = new Set<string>();
    for (const item of body.items) {
      if (!item || typeof item !== 'object') {
        return NextResponse.json(
          { success: false, error: 'Invalid prayer item in items array', code: 'VALIDATION_FAILED' },
          { status: 400 }
        );
      }

      if (!item.date || !isValidCalendarDate(item.date)) {
        return NextResponse.json(
          { success: false, error: `Invalid calendar date in YYYY-MM-DD format: ${item.date}`, code: 'INVALID_DATE' },
          { status: 400 }
        );
      }

      if (!item.prayerId || !VALID_PRAYER_IDS.includes(item.prayerId)) {
        return NextResponse.json(
          { success: false, error: `Invalid prayerId: ${item.prayerId}. Must be one of: ${VALID_PRAYER_IDS.join(', ')}`, code: 'INVALID_PRAYER_ID' },
          { status: 400 }
        );
      }

      const key = `${item.date}:${item.prayerId}`;
      if (seen.has(key)) {
        return NextResponse.json(
          { success: false, error: `Duplicate prayer in payment request: ${item.prayerId} on ${item.date}`, code: 'DUPLICATE_ITEM' },
          { status: 400 }
        );
      }
      seen.add(key);
    }

    await connectDB();

    // 2. Check Idempotency Key
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length > 0
        ? body.idempotencyKey.trim().slice(0, 128)
        : undefined;

    if (idempotencyKey) {
      const existingPayment = await QazaPayment.findOne({
        userId: auth.user.id,
        idempotencyKey,
      });

      if (existingPayment) {
        const allUserRecords = await PrayerRecord.find({ userId: auth.user.id });
        const remainingDebt = calculateAuthoritativeDebt(allUserRecords);

        return NextResponse.json(
          {
            success: true,
            data: {
              id: existingPayment._id.toString(),
              userId: existingPayment.userId.toString(),
              items: existingPayment.items.map((it) => ({
                prayerRecordId: it.prayerRecordId ? it.prayerRecordId.toString() : undefined,
                date: it.date,
                prayerId: it.prayerId,
                status: it.status,
                amount: it.amount,
                isOverdue: it.isOverdue,
              })),
              totalAmount: existingPayment.totalAmount,
              idempotencyKey: existingPayment.idempotencyKey,
              note: existingPayment.note,
              createdAt: existingPayment.createdAt.toISOString(),
              remainingFinancialDebt: remainingDebt.totalFinancialDebt,
              remainingPendingQazaCount: remainingDebt.pendingQazaCount,
            },
            message: 'Payment already processed (idempotent replay)',
          },
          { status: 200 }
        );
      }
    }

    // 3. Batch fetch relevant PrayerRecords for the authenticated user
    const uniqueDates = Array.from(new Set(body.items.map((it) => it.date)));
    const records = await PrayerRecord.find({
      userId: auth.user.id,
      date: { $in: uniqueDates },
    });
    const recordMap = new Map<string, IPrayerRecord>(records.map((r) => [r.date, r]));

    // 4. Verification Pass: verify ownership, eligibility, and calculate legitimate server-side amounts
    const now = new Date();

    interface VerifiedItem {
      record: IPrayerRecord;
      date: string;
      prayerId: PrayerId;
      status: PrayerStatus;
      amount: number;
      isOverdue: boolean;
    }

    const verifiedItems: VerifiedItem[] = [];

    for (const item of body.items) {
      const record = recordMap.get(item.date);
      if (!record) {
        return NextResponse.json(
          {
            success: false,
            error: `Prayer record for date ${item.date} does not exist`,
            code: 'RECORD_NOT_FOUND',
          },
          { status: 400 }
        );
      }

      const prayer = record.prayers[item.prayerId];
      if (!prayer) {
        return NextResponse.json(
          {
            success: false,
            error: `Prayer '${item.prayerId}' on date ${item.date} does not exist`,
            code: 'PRAYER_NOT_FOUND',
          },
          { status: 400 }
        );
      }

      // Only MISSED or MADE_UP prayers can be paid
      if (prayer.status !== 'MISSED' && prayer.status !== 'MADE_UP') {
        return NextResponse.json(
          {
            success: false,
            error: `Prayer '${item.prayerId}' on ${item.date} has status '${prayer.status}' and cannot be settled as Qaza. Only MISSED or MADE_UP prayers accrue fines.`,
            code: 'INVALID_PRAYER_STATUS_FOR_PAYMENT',
          },
          { status: 400 }
        );
      }

      // Check if already paid
      if (prayer.isPaid === true) {
        return NextResponse.json(
          {
            success: false,
            error: `Prayer '${item.prayerId}' on ${item.date} is already settled/paid`,
            code: 'ALREADY_PAID',
          },
          { status: 409 }
        );
      }

      // Server-side calculated legitimate amount using authoritative logic:
      // - MISSED: base 15,000 UZS. If > 7 days (daysPassed > 7), +15,000 UZS overdue fine (total 30,000 UZS).
      // - MADE_UP: base 15,000 UZS (capped, no overdue penalty).
      const todayStr = now.toISOString().split('T')[0];
      const daysPassed = calculateDaysPassed(item.date, todayStr);
      const isOverdue = prayer.status === 'MISSED' && isOverduePrayer(daysPassed);

      let calculatedAmount = BASE_PLEDGE_AMOUNT;
      if (prayer.status === 'MISSED' && isOverdue) {
        calculatedAmount = BASE_PLEDGE_AMOUNT + OVERDUE_PENALTY_AMOUNT;
      }

      verifiedItems.push({
        record,
        date: item.date,
        prayerId: item.prayerId,
        status: prayer.status,
        amount: calculatedAmount,
        isOverdue,
      });
    }

    // 5. Atomic Update Pass: mark prayers as paid and persist (preserves spiritual status: MISSED remains MISSED until made up by prayer)
    let totalAmount = 0;
    const receiptItems = [];
    const recordsToSave = new Set<IPrayerRecord>();

    for (const item of verifiedItems) {
      totalAmount += item.amount;
      const prayerObj = item.record.prayers[item.prayerId];
      // CRITICAL: DO NOT change prayerObj.status to 'MADE_UP'! If the prayer was 'MISSED', it remains 'MISSED'!
      // Qaza completion and financial settlement must remain separate states.
      prayerObj.isPaid = true;
      prayerObj.paidAt = now;
      prayerObj.paidAmount = item.amount;

      recordsToSave.add(item.record);

      receiptItems.push({
        prayerRecordId: item.record._id,
        date: item.date,
        prayerId: item.prayerId,
        status: prayerObj.status,
        amount: item.amount,
        isOverdue: item.isOverdue,
      });
    }

    // Recalculate finesAccrued for all touched records (paid prayers are skipped)
    for (const rec of recordsToSave) {
      rec.finesAccrued = calculateAccountabilityFines(rec.date, rec.prayers);
      if (typeof rec.markModified === 'function') {
        rec.markModified('prayers');
        rec.markModified('finesAccrued');
      }
      await rec.save();
    }

    // 6. Record QazaPayment audit document
    const paymentDoc = new QazaPayment({
      userId: auth.user.id,
      items: receiptItems,
      totalAmount,
      idempotencyKey,
      note: sanitizeNotes(body.note),
    });

    try {
      await paymentDoc.save();
    } catch (saveErr: unknown) {
      const err = saveErr as { code?: number };
      if (err?.code === 11000 && idempotencyKey) {
        const existing = await QazaPayment.findOne({ userId: auth.user.id, idempotencyKey });
        if (existing) {
          const allUserRecords = await PrayerRecord.find({ userId: auth.user.id });
          const remainingDebt = calculateAuthoritativeDebt(allUserRecords);

          return NextResponse.json(
            {
              success: true,
              data: {
                id: existing._id.toString(),
                userId: existing.userId.toString(),
                items: existing.items.map((it) => ({
                  prayerRecordId: it.prayerRecordId ? it.prayerRecordId.toString() : undefined,
                  date: it.date,
                  prayerId: it.prayerId,
                  status: it.status,
                  amount: it.amount,
                  isOverdue: it.isOverdue,
                })),
                totalAmount: existing.totalAmount,
                idempotencyKey: existing.idempotencyKey,
                note: existing.note,
                createdAt: existing.createdAt.toISOString(),
                remainingFinancialDebt: remainingDebt.totalFinancialDebt,
                remainingPendingQazaCount: remainingDebt.pendingQazaCount,
              },
              message: 'Payment already processed (idempotent replay)',
            },
            { status: 200 }
          );
        }
      }
      throw saveErr;
    }

    // Compute remaining debt and pending qaza count across all user records
    const allUserRecords = await PrayerRecord.find({ userId: auth.user.id });
    const remainingDebt = calculateAuthoritativeDebt(allUserRecords);

    return NextResponse.json(
      {
        success: true,
        data: {
          id: paymentDoc._id ? paymentDoc._id.toString() : new mongoose.Types.ObjectId().toString(),
          userId: auth.user.id,
          items: receiptItems.map((it) => ({
            prayerRecordId: it.prayerRecordId ? it.prayerRecordId.toString() : undefined,
            date: it.date,
            prayerId: it.prayerId,
            status: it.status,
            amount: it.amount,
            isOverdue: it.isOverdue,
          })),
          totalAmount,
          idempotencyKey: paymentDoc.idempotencyKey,
          note: paymentDoc.note,
          createdAt: paymentDoc.createdAt ? paymentDoc.createdAt.toISOString() : new Date().toISOString(),
          remainingFinancialDebt: remainingDebt.totalFinancialDebt,
          remainingPendingQazaCount: remainingDebt.pendingQazaCount,
        },
        message: 'Qaza fine payment recorded successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in POST /api/prayers/qaza-payment:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
