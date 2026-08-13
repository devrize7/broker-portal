import { afterEach, describe, expect, it, vi } from "vitest";
import { readScorecardControl, updateScorecardControl } from "@/lib/scorecard-control";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("scorecard server-to-server client", () => {
  it("fails closed without an explicit environment-matched control URL", async () => {
    vi.stubEnv("PORTAL_SCORECARD_TOKEN", "test-token");
    vi.stubEnv("SCORECARD_CONTROL_URL", "");
    await expect(readScorecardControl()).rejects.toThrow(/SCORECARD_CONTROL_URL/);
  });

  it("keeps the credential server-side and sends only the enabled switch", async () => {
    vi.stubEnv("PORTAL_SCORECARD_TOKEN", "test-token");
    vi.stubEnv("SCORECARD_CONTROL_URL", "https://command.test/api/scorecard");
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await updateScorecardControl(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://command.test/api/scorecard",
      expect.objectContaining({
        method: "PATCH",
        headers: {
          Authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: true }),
      }),
    );
  });
});
