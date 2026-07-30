/** Shared display formatting for the broker surfaces. */

export function fmtMoney(n: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function fmtK(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return fmtMoney(n);
}

/** `2026-07-29` → `Jul 29, 2026`. Rendered at noon UTC so the day can't slip. */
export function fmtDate(ymd: string, withYear = true): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** "3 weeks ago" style gap for a dormant account. */
export function fmtGap(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = days / 365;
  return years < 2 ? "over a year ago" : `${Math.floor(years)} years ago`;
}
