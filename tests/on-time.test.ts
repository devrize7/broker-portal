import { describe, expect, it } from "vitest";
import { computeOnTime, summarizeOnTime } from "@/lib/on-time";

describe("computeOnTime", () => {
  it("grades arrival before the appointment close as on time", () => {
    expect(computeOnTime("2026-08-10T17:00:00Z", "2026-08-10T15:30:00Z")).toBe("on_time");
  });

  it("treats arrival exactly at the close as on time (no grace, strict <=)", () => {
    expect(computeOnTime("2026-08-10T17:00:00Z", "2026-08-10T17:00:00Z")).toBe("on_time");
  });

  it("grades arrival after the close as late", () => {
    expect(computeOnTime("2026-08-10T17:00:00Z", "2026-08-10T17:00:01Z")).toBe("late");
  });

  it("returns null without an appointment window — never assumes on time", () => {
    expect(computeOnTime(null, "2026-08-10T15:30:00Z")).toBeNull();
  });

  it("returns null when the load has not arrived", () => {
    expect(computeOnTime("2026-08-10T17:00:00Z", null)).toBeNull();
  });

  it("returns null on an unparseable timestamp rather than throwing", () => {
    expect(computeOnTime("not-a-date", "2026-08-10T15:30:00Z")).toBeNull();
  });
});

describe("summarizeOnTime", () => {
  it("reports null rather than 100% when nothing is gradeable", () => {
    const s = summarizeOnTime([
      { deliveryApptClose: null, deliveryActualArrival: "2026-08-10T15:00:00Z" },
      { deliveryApptClose: null, deliveryActualArrival: "2026-08-11T15:00:00Z" },
    ]);
    expect(s.onTimePct).toBeNull();
    expect(s.measured).toBe(0);
    expect(s.arrived).toBe(2);
    expect(s.coveragePct).toBe(0);
  });

  it("excludes ungradeable loads from the denominator instead of counting them as wins", () => {
    const s = summarizeOnTime([
      { deliveryApptClose: "2026-08-10T17:00:00Z", deliveryActualArrival: "2026-08-10T16:00:00Z" }, // on time
      { deliveryApptClose: "2026-08-10T17:00:00Z", deliveryActualArrival: "2026-08-10T18:00:00Z" }, // late
      { deliveryApptClose: null, deliveryActualArrival: "2026-08-10T18:00:00Z" }, // ungradeable
    ]);
    expect(s.measured).toBe(2);
    expect(s.onTimeCount).toBe(1);
    expect(s.onTimePct).toBe(50);
  });

  it("measures coverage against arrived loads, not all loads", () => {
    const s = summarizeOnTime([
      { deliveryApptClose: "2026-08-10T17:00:00Z", deliveryActualArrival: "2026-08-10T16:00:00Z" },
      { deliveryApptClose: null, deliveryActualArrival: "2026-08-10T18:00:00Z" },
      // In transit: no arrival at all, so it is not part of coverage either way.
      { deliveryApptClose: "2026-08-12T17:00:00Z", deliveryActualArrival: null },
    ]);
    expect(s.arrived).toBe(2);
    expect(s.measured).toBe(1);
    expect(s.coveragePct).toBe(50);
  });

  it("is empty-safe", () => {
    const s = summarizeOnTime([]);
    expect(s).toEqual({
      onTimePct: null,
      onTimeCount: 0,
      measured: 0,
      arrived: 0,
      coveragePct: null,
    });
  });
});
