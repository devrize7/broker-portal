// STATUS FILTERING — CRITICAL
// Single source of truth for which TAI load statuses are excluded from all
// countable-load metrics (leaderboard, contest, history, carrier pages).
// Mirrors freight-dashboard lib/domain/load-countability.ts (PR devrize7/freight-dashboard#336).
//
// "ready" is TAI's pre-dispatch status: no carrier assigned yet, carrierCost $0,
// so counting it would report full revenue as margin.
export const EXCLUDED_STATUSES = [
  "booked",
  "committed",
  "cancelled",
  "quote",
  "sent",
  "ready",
];
