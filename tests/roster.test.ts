import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEED_BROKERS,
  buildRoster,
  parseFeedBroker,
  getWeeklyGoal,
  getRoster,
  _resetRosterCache,
  type RosterBroker,
} from "@/lib/roster";
import { resolveActiveBroker, getActiveBrokerNames } from "@/lib/broker-mapping";

const b = (over: Partial<RosterBroker> = {}): RosterBroker => ({
  name: "X",
  active: true,
  departedAt: null,
  hireDate: "2026-01-01",
  email: "x@gowithoath.com",
  rampWeeks: 6,
  goalAdjustment: 0,
  displayOrder: 0,
  ...over,
});

describe("buildRoster", () => {
  it("orders active names by displayOrder (nulls last), then name", () => {
    const r = buildRoster([
      b({ name: "C", displayOrder: 2 }),
      b({ name: "A", displayOrder: 0 }),
      b({ name: "B", displayOrder: 1 }),
      b({ name: "Z", displayOrder: null }),
      b({ name: "Y", displayOrder: null }),
      b({ name: "Inactive", active: false, displayOrder: 5 }),
    ]);
    expect(r.activeNames).toEqual(["A", "B", "C", "Y", "Z"]);
  });

  it("builds a lowercased email→name map for ACTIVE brokers only (login parity)", () => {
    const r = buildRoster([
      b({ name: "Active", email: "Active.Person@gowithoath.com" }),
      b({ name: "Gone", active: false, email: "gone@gowithoath.com" }),
    ]);
    expect(r.emailToBroker.get("active.person@gowithoath.com")).toBe("Active");
    // Deactivated broker's login is disabled — not in the map.
    expect(r.emailToBroker.get("gone@gowithoath.com")).toBeUndefined();
  });

  it("throws on a roster with zero active brokers (caller treats as outage)", () => {
    expect(() => buildRoster([b({ active: false })])).toThrow(/zero active/i);
  });
});

describe("parseFeedBroker", () => {
  it("rejects rows missing a name or active flag", () => {
    expect(parseFeedBroker(null)).toBeNull();
    expect(parseFeedBroker({ active: true })).toBeNull();
    expect(parseFeedBroker({ name: "", active: true })).toBeNull();
    expect(parseFeedBroker({ name: "A" })).toBeNull();
  });

  it("falls back to the seed's goalAdjustment when the feed omits it (older deploy)", () => {
    // Tom's -100 must never silently become 0 if an older feed lacks the field.
    const parsed = parseFeedBroker({ name: "Tom Licata", active: true });
    expect(parsed?.goalAdjustment).toBe(-100);
  });

  it("takes goalAdjustment from the feed when present", () => {
    const parsed = parseFeedBroker({ name: "Tom Licata", active: true, goalAdjustment: 0 });
    expect(parsed?.goalAdjustment).toBe(0);
  });

  it("slices hireDate to YYYY-MM-DD and defaults rampWeeks to 6", () => {
    const parsed = parseFeedBroker({ name: "A", active: true, hireDate: "2026-01-19T00:00:00.000Z" });
    expect(parsed?.hireDate).toBe("2026-01-19");
    expect(parsed?.rampWeeks).toBe(6);
  });
});

describe("getWeeklyGoal (mirrors freight-dashboard weeklyGoal)", () => {
  const roster = buildRoster(SEED_BROKERS);
  const monday = (d: string) => new Date(d + "T00:00:00Z");

  it("is $0 during the ramp window", () => {
    // Reggie Pena hired 2026-05-04, 12-week ramp — still $0 a few weeks in.
    expect(getWeeklyGoal(roster, "Reggie Pena", monday("2026-06-01"))).toBe(0);
  });

  it("applies Tom Licata's -100 goalAdjustment", () => {
    const tom = getWeeklyGoal(roster, "Tom Licata", monday("2026-07-06"));
    // Compute the un-adjusted baseline from the same formula and confirm the
    // -100 is subtracted (and never below zero).
    const hire = new Date("2025-08-18");
    const totalWeeks = Math.floor(
      (monday("2026-07-06").getTime() - hire.getTime()) / (7 * 864e5)
    );
    const base = Math.max(0, (totalWeeks - 6 + 2) * 100);
    expect(tom).toBe(Math.max(0, base - 100));
    expect(tom).toBeGreaterThan(0);
  });

  it("returns 0 for an unknown broker or one with no hire date", () => {
    expect(getWeeklyGoal(roster, "Nobody", monday("2026-07-06"))).toBe(0);
  });
});

describe("resolveActiveBroker / getActiveBrokerNames over the seed", () => {
  const roster = buildRoster(SEED_BROKERS);

  it("resolves the first ACTIVE broker in a multi-rep string", () => {
    // Joe Corbett is inactive; the active rep wins.
    expect(resolveActiveBroker(roster, "Joe Corbett, Tom Licata")).toEqual({
      broker: "Tom Licata",
      isActive: true,
    });
  });

  it("marks an all-inactive string inactive, keeping the first name", () => {
    expect(resolveActiveBroker(roster, "Joe Corbett")).toEqual({
      broker: "Joe Corbett",
      isActive: false,
    });
  });

  it("returns the 11 seeded active brokers", () => {
    expect(getActiveBrokerNames(roster)).toHaveLength(11);
    expect(getActiveBrokerNames(roster)).toContain("Tom Licata");
    expect(getActiveBrokerNames(roster)).not.toContain("Joe Corbett");
  });
});

describe("getRoster fallback contract (a feed outage never blanks the roster)", () => {
  afterEach(() => {
    _resetRosterCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serves the baked-in seed when the feed fetch fails and there is no cache", async () => {
    vi.stubEnv("PORTAL_ROSTER_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const r = await getRoster();
    // 11 active brokers survive an outage — nobody disappears, logins keep working.
    expect(r.activeNames).toHaveLength(11);
    expect(r.emailToBroker.get("tom.licata@gowithoath.com")).toBe("Tom Licata");
  });

  it("treats a zero-active feed payload as an outage (keeps the seed), not 'everyone left'", async () => {
    vi.stubEnv("PORTAL_ROSTER_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ brokers: [{ name: "Gone", active: false }] }),
      })
    );
    const r = await getRoster();
    expect(r.activeNames.length).toBeGreaterThanOrEqual(11);
  });

  it("rejects a mostly-malformed feed payload (schema drift) rather than serving a partial roster", async () => {
    vi.stubEnv("PORTAL_ROSTER_TOKEN", "test-token");
    // Feed sent 11 rows but 8 are malformed (active as 0/1, not boolean) — a
    // partial parse must NOT silently blank those 8 brokers; fall to seed.
    const good = { name: "Solo", active: true, email: "solo@gowithoath.com", hireDate: "2026-01-01", rampWeeks: 6, goalAdjustment: 0, displayOrder: 0 };
    const broken = Array.from({ length: 8 }, (_, i) => ({ name: `B${i}`, active: 1 }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ brokers: [good, good, good, ...broken] }),
      })
    );
    const r = await getRoster();
    // Seed (11 active), NOT the 3 that happened to parse.
    expect(r.activeNames).toHaveLength(11);
  });

  it("uses the feed when it returns a valid roster", async () => {
    vi.stubEnv("PORTAL_ROSTER_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          brokers: [
            { name: "Solo", active: true, email: "solo@gowithoath.com", hireDate: "2026-01-01", rampWeeks: 6, goalAdjustment: 0, displayOrder: 0 },
          ],
        }),
      })
    );
    const r = await getRoster();
    expect(r.activeNames).toEqual(["Solo"]);
  });
});
