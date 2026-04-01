import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cityToCoords } from "@/lib/city-coords";

export const dynamic = "force-dynamic";

const EXCLUDED = ["booked", "committed", "cancelled", "quote", "sent"];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const weeks = parseInt(searchParams.get("weeks") || "12", 10);

    const since = new Date();
    since.setDate(since.getDate() - weeks * 7);

    const excluded = EXCLUDED.map(() => "?").join(",");
    // Columns: [0]=loadNumber [1]=origin [2]=destination [3]=carrier [4]=salesRep [5]=revenue [6]=carrierCost [7]=pickupDate [8]=status
    const result = await db.execute({
      sql: `SELECT loadNumber, origin, destination, carrier, salesRep, revenue, carrierCost, pickupDate, status
            FROM Load WHERE pickupDate >= ? AND status NOT IN (${excluded}) ORDER BY pickupDate DESC`,
      args: [since.toISOString(), ...EXCLUDED],
    });

    const lanes = result.rows.map((r) => {
      const origin = r[1] as string;
      const destination = r[2] as string;
      const carrier = (r[3] as string) || "Unknown";
      const salesRep = r[4] as string | null;
      const revenue = r[5] as number;
      const carrierCost = r[6] as number;

      const originCoords = cityToCoords(origin);
      const destCoords = cityToCoords(destination);
      if (!originCoords || !destCoords) return null;

      return {
        loadNumber: r[0] as string,
        origin,
        destination,
        carrier,
        salesRep,
        originCoords,
        destCoords,
        revenue,
        carrierCost,
        margin: revenue - carrierCost,
        pickupDate: r[7] as string,
        status: r[8] as string,
      };
    }).filter(Boolean);

    const carrierMap: Record<string, { loads: number; totalCost: number; states: Set<string> }> = {};
    for (const l of lanes) {
      if (!l) continue;
      if (!carrierMap[l.carrier]) carrierMap[l.carrier] = { loads: 0, totalCost: 0, states: new Set() };
      carrierMap[l.carrier].loads += 1;
      carrierMap[l.carrier].totalCost += l.carrierCost;
      const os = l.origin.split(",")[1]?.trim();
      const ds = l.destination.split(",")[1]?.trim();
      if (os) carrierMap[l.carrier].states.add(os);
      if (ds) carrierMap[l.carrier].states.add(ds);
    }

    const carriers = Object.entries(carrierMap).map(([name, d]) => ({
      name, loads: d.loads, avgCost: d.loads > 0 ? d.totalCost / d.loads : 0, states: Array.from(d.states).sort(),
    })).sort((a, b) => b.loads - a.loads);

    return NextResponse.json({ lanes, carriers, total: lanes.length });
  } catch (err) {
    console.error("Carriers error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
