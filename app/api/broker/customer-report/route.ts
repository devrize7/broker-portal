import { NextRequest, NextResponse } from "next/server";
import { requireBrokerAccess } from "@/lib/route-auth";
import { getRoster } from "@/lib/roster";
import { db } from "@/lib/db";
import { etYmd, fetchCountableLoads, loadsForBroker } from "@/lib/load-query";
import { buildCustomerReport, type ReportLoad } from "@/lib/customer-report";
import { parsePreset, resolveRange } from "@/lib/date-ranges";

export const dynamic = "force-dynamic";

/**
 * Per-load fields the report needs that `CountableLoad` does not carry —
 * mileage, delivery timing, and the two TAI stop timestamps behind on-time.
 *
 * Fetched separately and joined by loadNumber rather than widened into
 * `fetchCountableLoads()`: every other surface in the portal pays for that
 * query, and none of them need these columns.
 */
interface ReportFields {
  miles: number | null;
  deliveryDate: string | null;
  deliveryApptClose: string | null;
  deliveryActualArrival: string | null;
}

async function fetchReportFields(customer: string): Promise<Map<string, ReportFields>> {
  const result = await db.execute({
    sql: `SELECT loadNumber, miles, deliveryDate, deliveryApptClose, deliveryActualArrival
          FROM Load WHERE customer = ?`,
    args: [customer],
  });

  const byLoad = new Map<string, ReportFields>();
  for (const r of result.rows) {
    byLoad.set(String(r.loadNumber), {
      miles: r.miles === null ? null : Number(r.miles) || 0,
      deliveryDate: (r.deliveryDate as string | null) ?? null,
      deliveryApptClose: (r.deliveryApptClose as string | null) ?? null,
      deliveryActualArrival: (r.deliveryActualArrival as string | null) ?? null,
    });
  }
  return byLoad;
}

/**
 * Cancelled loads for this broker + customer inside the window.
 *
 * Its own query because cancelled loads are excluded from the countable set
 * everywhere else in the portal — but acceptance rate is exactly a statement
 * about them, so the report has to see what the rest of the portal filters out.
 * Attribution is by raw salesRep here rather than resolveActiveBroker: a
 * cancelled load has no revenue to misattribute, and pulling the roster through
 * a second path would be a second place for the two to drift.
 */
async function fetchCancelledCount(
  customer: string,
  salesReps: Set<string>,
  from: string,
  toExclusive: string
): Promise<number> {
  if (salesReps.size === 0) return 0;
  const result = await db.execute({
    sql: `SELECT salesRep, pickupDate FROM Load
          WHERE customer = ? AND LOWER(status) = 'cancelled' AND pickupDate IS NOT NULL`,
    args: [customer],
  });

  let count = 0;
  for (const r of result.rows) {
    const rep = (r.salesRep as string | null) ?? "";
    if (!salesReps.has(rep)) continue;
    const ymd = etYmd(String(r.pickupDate));
    if (ymd >= from && ymd < toExclusive) count++;
  }
  return count;
}

/**
 * Claims filed against this customer, or null if the table could not be read.
 *
 * The Claim table belongs to the dashboard, not this app. If its shape changes,
 * the client report should still render — but it must NOT then print "0 claims".
 * That is a clean-record assurance handed to the customer on the strength of a
 * failed query. Null renders as "—".
 */
async function fetchClaimsCount(customer: string): Promise<number | null> {
  try {
    const result = await db.execute({
      sql: `SELECT COUNT(*) n FROM Claim WHERE customer = ?`,
      args: [customer],
    });
    return Number(result.rows[0]?.n) || 0;
  } catch (err) {
    console.error("Customer report: claims lookup failed", err);
    return null;
  }
}

/**
 * The customer client report: one customer, through one broker's eyes,
 * formatted to be handed to that customer.
 *
 * Scoped to the broker's OWN loads with the customer, exactly like
 * /api/broker/customer. On an account shared with another rep these totals are
 * a subset of the customer's Oath activity, which is why the response carries
 * `brokerScoped` — the page prints a disclosure rather than letting a customer
 * reconcile a short number against their own records.
 *
 * No margin, cost, or commission appears in this response. See lib/customer-report.ts.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const access = await requireBrokerAccess(params.get("broker"));
  if (!access.ok) return access.response;
  const broker = access.broker;

  const customer = (params.get("customer") ?? "").trim();
  if (!customer) {
    return NextResponse.json({ error: "customer is required" }, { status: 400 });
  }

  const range = resolveRange(parsePreset(params.get("preset")), {
    from: params.get("from"),
    to: params.get("to"),
  });

  try {
    const [roster, allLoads] = await Promise.all([getRoster(), fetchCountableLoads()]);

    const mine = loadsForBroker(allLoads, roster, broker).filter(
      (l) =>
        l.customer === customer &&
        l.pickupYmd >= range.from &&
        l.pickupYmd < range.toExclusive
    );

    // A broker who has never run this customer gets nothing — not an empty
    // report for someone else's account. This is the scoping promise in force:
    // the customer's existence is itself information the broker has not earned.
    if (mine.length === 0) {
      return NextResponse.json(
        { error: "No loads for this customer under this broker in the selected period." },
        { status: 404 }
      );
    }

    const salesReps = new Set(mine.map((l) => l.salesRep ?? "").filter(Boolean));

    const [fields, cancelled, claimsCount] = await Promise.all([
      fetchReportFields(customer),
      fetchCancelledCount(customer, salesReps, range.from, range.toExclusive),
      fetchClaimsCount(customer),
    ]);

    const reportLoads: ReportLoad[] = mine.map((l) => {
      const extra = fields.get(l.loadNumber);
      return {
        loadNumber: l.loadNumber,
        pickupYmd: l.pickupYmd,
        origin: l.origin,
        destination: l.destination,
        carrier: l.carrier,
        status: l.status,
        // Lumper revenue is a pass-through the customer is billed for and then
        // credited; including it would overstate what they spent on freight.
        revenue: l.revenue - l.lumperRevenue,
        miles: extra?.miles ?? null,
        deliveryDate: extra?.deliveryDate ?? null,
        deliveryApptClose: extra?.deliveryApptClose ?? null,
        deliveryActualArrival: extra?.deliveryActualArrival ?? null,
      };
    });

    const report = buildCustomerReport(reportLoads, cancelled, claimsCount);

    return NextResponse.json({
      customer,
      broker,
      rangeFrom: range.from,
      rangeTo: range.toDisplay,
      rangeLabel: range.label,
      /** True whenever another active rep also runs this account. */
      brokerScoped: true,
      ...report,
    });
  } catch (err) {
    console.error("Customer report error:", err);
    return NextResponse.json({ error: "Failed to build customer report" }, { status: 500 });
  }
}
