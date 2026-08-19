import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.hoisted(() => vi.fn());
const readScorecardControlMock = vi.hoisted(() => vi.fn());
const updateScorecardControlMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/route-auth", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/scorecard-control", () => ({
  readScorecardControl: readScorecardControlMock,
  updateScorecardControl: updateScorecardControlMock,
}));

import { GET, PATCH } from "@/app/api/admin/broker-scorecard/route";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ isAdmin: true, response: null });
});

describe("broker portal scorecard admin proxy", () => {
  it("blocks a regular broker before calling the backend", async () => {
    requireAdminMock.mockResolvedValue({
      isAdmin: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(readScorecardControlMock).not.toHaveBeenCalled();
  });

  it("returns the server-side control feed to an admin", async () => {
    readScorecardControlMock.mockResolvedValue(Response.json({ automation: { enabled: false } }));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ automation: { enabled: false } });
  });

  it("allows only an enabled boolean mutation", async () => {
    updateScorecardControlMock.mockResolvedValue(Response.json({ ok: true, enabled: true }));
    const response = await PATCH(new Request("https://portal.test/api/admin/broker-scorecard", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }) as any);
    expect(response.status).toBe(200);
    expect(updateScorecardControlMock).toHaveBeenCalledWith(true);
  });

  it("rejects cadence or recipient edits", async () => {
    const response = await PATCH(new Request("https://portal.test/api/admin/broker-scorecard", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, cc: ["someone@example.com"] }),
    }) as any);
    expect(response.status).toBe(400);
    expect(updateScorecardControlMock).not.toHaveBeenCalled();
  });
});
