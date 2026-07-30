/**
 * What a customer OWES — open AR and how much of it is late.
 *
 * ⚠ DELIBERATE CROSS-REPO MIRROR of freight-dashboard `lib/ar-collections.ts`
 * (`buildCollections`, the openLoads aggregation ~line 506-560). The two must
 * agree exactly: a broker reading "$33,650 overdue" here and Jacob reading a
 * different figure on the Collections page for the same customer is precisely
 * the confusion this feature was built to remove. **Change both together.**
 *
 * The rules copied from there, each load-bearing:
 *
 *  - Source set is `invoiceBalance > 0 AND writtenOffAt IS NULL`, with **no
 *    status filter** — an open invoice implies dispatched-or-later already, and
 *    written-off balances are excluded from every AR surface.
 *  - Due basis is `invoiceDate ?? pickupDate`, plus net-30. The fallback
 *    matters: a load whose `invoiceDate` the cron hasn't backfilled from TAI yet
 *    would otherwise read `daysOverdue = 0` → "current" → escape the chase
 *    entirely, even if it was picked up months ago.
 *  - **Overdue counts only ACTIVE loads** — not on dunning hold, not disputed,
 *    not under a future promise-to-pay. Those are deliberately parked, so
 *    counting them as overdue would overstate the number against Collections
 *    and misrepresent an account someone is already handling.
 *  - `totalOpen`, by contrast, is EVERY open load including the parked ones.
 *
 * Balances are the dashboard's synced snapshot (`Load.invoiceBalance`), which
 * lags TAI between cron ticks. That is correct for DISPLAY and must never drive
 * a money decision — the portal has no money paths, and must not grow one.
 *
 * Pure and side-effect free; `nowMs` is passed in.
 */

const DAY = 86_400_000;

/** Net terms used for the due date. Mirrors NET_DAYS in ar-collections.ts. */
export const NET_DAYS = 30;

export interface ArLoadRow {
  customer: string;
  invoiceBalance: number;
  /** ISO timestamps, or null. */
  invoiceDate: string | null;
  pickupDate: string | null;
  dunningHold: boolean;
  disputedAt: string | null;
  ptpDate: string | null;
}

export interface CustomerAr {
  /** Every open invoice, including held / disputed / future-PTP loads. */
  totalOpen: number;
  invoiceCount: number;
  /** Past-due money on ACTIVE loads only. */
  overdueTotal: number;
  overdueCount: number;
  /** Days past due of the oldest ACTIVE overdue load; 0 when nothing is late. */
  oldestDaysOverdue: number;
  /** Open money deliberately parked (hold / dispute / promise-to-pay). */
  parkedTotal: number;
}

function emptyAr(): CustomerAr {
  return {
    totalOpen: 0,
    invoiceCount: 0,
    overdueTotal: 0,
    overdueCount: 0,
    oldestDaysOverdue: 0,
    parkedTotal: 0,
  };
}

export function buildCustomerAr(rows: ArLoadRow[], nowMs: number): Map<string, CustomerAr> {
  const byCustomer = new Map<string, CustomerAr>();

  for (const row of rows) {
    const customer = row.customer?.trim();
    if (!customer) continue;
    if (!(row.invoiceBalance > 0)) continue;

    const agg = byCustomer.get(customer) ?? emptyAr();

    const basis = row.invoiceDate ?? row.pickupDate;
    const due = basis ? new Date(basis).getTime() + NET_DAYS * DAY : null;
    const daysOverdue = due ? Math.floor((nowMs - due) / DAY) : 0;

    const held = row.dunningHold === true;
    const disputed = !!row.disputedAt;
    const futurePtp = !!(row.ptpDate && new Date(row.ptpDate).getTime() >= nowMs);
    const active = !held && !disputed && !futurePtp;

    agg.totalOpen += row.invoiceBalance;
    agg.invoiceCount += 1;
    if (!active) agg.parkedTotal += row.invoiceBalance;
    if (active && daysOverdue > 0) {
      agg.overdueTotal += row.invoiceBalance;
      agg.overdueCount += 1;
      if (daysOverdue > agg.oldestDaysOverdue) agg.oldestDaysOverdue = daysOverdue;
    }

    byCustomer.set(customer, agg);
  }

  return byCustomer;
}

/**
 * Is this account bad enough that a broker should think twice before booking?
 *
 * Advisory only — nothing is blocked, and the portal deliberately offers no way
 * to act on it. Chasing belongs to the collectors on the Collections page; a
 * broker calling the customer would cut across a dunning cadence they can't see.
 */
export const AR_ALERT_MIN_DAYS = 30;

export function isSeriouslyPastDue(ar: CustomerAr | undefined): boolean {
  return !!ar && ar.overdueTotal > 0 && ar.oldestDaysOverdue >= AR_ALERT_MIN_DAYS;
}
