import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-auth";
import { readScorecardControl, updateScorecardControl } from "@/lib/scorecard-control";

export const dynamic = "force-dynamic";

function unavailable() {
  return NextResponse.json({ error: "Scorecard controls are temporarily unavailable" }, { status: 502 });
}

export async function GET() {
  const { isAdmin, response } = await requireAdmin();
  if (!isAdmin) return response;

  try {
    const upstream = await readScorecardControl();
    if (!upstream.ok) return unavailable();
    return NextResponse.json(await upstream.json());
  } catch {
    return unavailable();
  }
}

export async function PATCH(request: NextRequest) {
  const { isAdmin, response } = await requireAdmin();
  if (!isAdmin) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    typeof (body as Record<string, unknown>).enabled !== "boolean" ||
    Object.keys(body).some((key) => key !== "enabled")
  ) {
    return NextResponse.json({ error: "Body must contain only enabled: boolean" }, { status: 400 });
  }

  try {
    const upstream = await updateScorecardControl((body as { enabled: boolean }).enabled);
    if (!upstream.ok) return unavailable();
    return NextResponse.json(await upstream.json());
  } catch {
    return unavailable();
  }
}
