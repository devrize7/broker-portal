/**
 * On-time delivery, computed from real TAI stop timestamps.
 *
 * Ported from freight-dashboard `lib/domain/on-time.ts`, which is the canonical
 * copy. Deliberately NOT derived from `Load.onTime`: that column is hardcoded
 * true across the book and reads as a fake 100%.
 *
 * A load is on-time when the carrier's actual arrival at the delivery stop is at
 * or before the appointment-close window. Both come from TAI's "Last Drop" stop
 * (`deliveryApptClose` / `deliveryActualArrival`).
 *
 * COVERAGE MATTERS HERE. Only about half of delivered loads carry an
 * appointment-close window. Without one there is no target to be late against,
 * so the load is unmeasurable — it returns null and is excluded from the
 * denominator rather than counted as a success. This is why the report renders
 * on-time alongside its coverage: on a customer-facing document, an unqualified
 * "100% on-time" drawn from three gradeable loads would be a claim we cannot
 * stand behind.
 *
 * Strict comparison (arrival <= close, no grace window) matches the dashboard.
 */

export type OnTimeStatus = "on_time" | "late" | null;

function toMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * on_time / late for a measurable load; null when either timestamp is missing.
 * Never assume on-time from absence.
 */
export function computeOnTime(
  apptClose: string | null | undefined,
  actualArrival: string | null | undefined
): OnTimeStatus {
  const close = toMs(apptClose);
  const arrival = toMs(actualArrival);
  if (close === null || arrival === null) return null;
  return arrival <= close ? "on_time" : "late";
}

export interface OnTimeLoadFields {
  deliveryApptClose?: string | null;
  deliveryActualArrival?: string | null;
}

export interface OnTimeSummary {
  /** On-time share of the MEASURED loads; null when nothing is measurable. */
  onTimePct: number | null;
  onTimeCount: number;
  /** Loads with both timestamps — the on-time denominator. */
  measured: number;
  /** Loads that actually arrived per TAI — the coverage denominator. */
  arrived: number;
  /** measured / arrived: the share of arrived loads we can grade. */
  coveragePct: number | null;
}

/**
 * Aggregate on-time and coverage over a set of loads.
 *
 * Coverage is measured over ARRIVED loads, so it answers "of the loads that
 * delivered, how many had an appointment we could grade against" — it never
 * conflates "no appointment" with "on time".
 */
export function summarizeOnTime(loads: OnTimeLoadFields[]): OnTimeSummary {
  let arrived = 0;
  let measured = 0;
  let onTimeCount = 0;

  for (const l of loads) {
    if (l.deliveryActualArrival) arrived++;
    const status = computeOnTime(l.deliveryApptClose, l.deliveryActualArrival);
    if (status !== null) {
      measured++;
      if (status === "on_time") onTimeCount++;
    }
  }

  return {
    onTimePct: measured > 0 ? (onTimeCount / measured) * 100 : null,
    onTimeCount,
    measured,
    arrived,
    coveragePct: arrived > 0 ? (measured / arrived) * 100 : null,
  };
}
