import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveActiveBroker, getActiveBrokerNames } from "@/lib/broker-mapping";

export const dynamic = "force-dynamic";

const CONTEST_START = "2026-02-20";
const EXCLUDED_STATUSES = ["booked", "committed", "cancelled", "quote", "sent", "ready"];

export async function GET() {
  try {
    const activeBrokers = getActiveBrokerNames();

    // Run both queries concurrently
    const [contestResult, preContestResult] = await Promise.all([
      db.execute({
        sql: `SELECT salesRep, customer, revenue, (revenue - carrierCost) as margin, pickupDate, status
              FROM Load WHERE pickupDate >= ? AND customer IS NOT NULL`,
        args: [CONTEST_START],
      }),
      db.execute({
        sql: `SELECT DISTINCT customer FROM Load WHERE pickupDate < ? AND customer IS NOT NULL`,
        args: [CONTEST_START],
      }),
    ]);

    const existingCustomers = new Set<string>();
    for (const row of preContestResult.rows) {
      existingCustomers.add(row.customer as string);
    }

    const contestMap = new Map<string, Map<string, { loads: number; gp: number; revenue: number; firstPickup: string }>>();

    for (const row of contestResult.rows) {
      const status = (row.status as string || "").toLowerCase();
      if (EXCLUDED_STATUSES.includes(status)) continue;

      const revenue = Number(row.revenue) || 0;
      const margin = Number(row.margin) || 0;
      if (revenue === 0 && margin === 0) continue;

      const salesRep = row.salesRep as string;
      const customer = row.customer as string;
      if (!salesRep || !customer) continue;

      // Skip existing customers
      if (existingCustomers.has(customer)) continue;

      const reps = salesRep.split(",").map((r) => r.trim());
      let activeBroker: string | null = null;
      for (const r of reps) {
        const { broker, isActive } = resolveActiveBroker(r);
        if (isActive) { activeBroker = broker; break; }
      }
      if (!activeBroker) continue;

      if (!contestMap.has(activeBroker)) contestMap.set(activeBroker, new Map());
      const brokerMap = contestMap.get(activeBroker)!;
      const existing = brokerMap.get(customer) || { loads: 0, gp: 0, revenue: 0, firstPickup: "2099-01-01" };
      existing.loads++;
      existing.gp += margin;
      existing.revenue += revenue;
      const pickup = row.pickupDate as string;
      if (pickup && pickup < existing.firstPickup) existing.firstPickup = pickup;
      brokerMap.set(customer, existing);
    }

    const brokers = Array.from(contestMap.entries())
      .map(([broker, customers]) => {
        const customerList = Array.from(customers.entries())
          .map(([customer, data]) => ({
            customer,
            loads: data.loads,
            gp: Math.round(data.gp * 100) / 100,
            revenue: Math.round(data.revenue * 100) / 100,
            firstPickup: data.firstPickup,
          }))
          .sort((a, b) => b.gp - a.gp);
        return {
          broker,
          customers: customerList,
          totalGP: customerList.reduce((s, c) => s + c.gp, 0),
          totalLoads: customerList.reduce((s, c) => s + c.loads, 0),
          totalRevenue: customerList.reduce((s, c) => s + c.revenue, 0),
          newCustomerCount: customerList.length,
        };
      })
      .sort((a, b) => b.totalGP - a.totalGP);

    // Ensure all active brokers appear
    for (const name of activeBrokers) {
      if (!brokers.find((b) => b.broker === name)) {
        brokers.push({ broker: name, customers: [], totalGP: 0, totalLoads: 0, totalRevenue: 0, newCustomerCount: 0 });
      }
    }

    return NextResponse.json({ brokers, contestStart: CONTEST_START });
  } catch (err) {
    console.error("Sales contest error:", err);
    return NextResponse.json({ error: "Failed to load sales contest" }, { status: 500 });
  }
}
