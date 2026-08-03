import { describe, expect, it } from "vitest";
import { resolveLeaderboardPeriod } from "@/lib/leaderboard-periods";

const now = new Date("2026-08-03T15:00:00.000Z"); // Monday in ET

describe("leaderboard period ranges", () => {
  it("defaults weekly to the current Monday-Sunday window", () => {
    expect(resolveLeaderboardPeriod("weekly", { now })).toMatchObject({
      from: "2026-08-03",
      toExclusive: "2026-08-10",
      toDisplay: "2026-08-09",
      label: "Weekly",
    });
  });

  it("supports historical weekly windows", () => {
    expect(resolveLeaderboardPeriod("weekly", { now, weekOffset: -1 })).toMatchObject({
      from: "2026-07-27",
      toExclusive: "2026-08-03",
    });
  });

  it("resolves month, quarter, and year boundaries", () => {
    expect(resolveLeaderboardPeriod("monthly", { now })).toMatchObject({ from: "2026-08-01", toExclusive: "2026-09-01" });
    expect(resolveLeaderboardPeriod("quarterly", { now })).toMatchObject({ from: "2026-07-01", toExclusive: "2026-10-01" });
    expect(resolveLeaderboardPeriod("yearly", { now })).toMatchObject({ from: "2026-01-01", toExclusive: "2027-01-01" });
  });

  it("keeps all-time open-ended", () => {
    expect(resolveLeaderboardPeriod("all-time", { now })).toMatchObject({
      from: "0001-01-01",
      toExclusive: "9999-12-31",
      label: "All-Time",
    });
  });
});
