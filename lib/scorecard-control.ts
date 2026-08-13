function controlConfig() {
  const token = process.env.PORTAL_SCORECARD_TOKEN?.trim();
  const url = process.env.SCORECARD_CONTROL_URL?.trim();
  if (!token) throw new Error("PORTAL_SCORECARD_TOKEN is not configured");
  if (!url) throw new Error("SCORECARD_CONTROL_URL is not configured");
  return {
    url,
    token,
  };
}

export async function readScorecardControl(): Promise<Response> {
  const { url, token } = controlConfig();
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
}

export async function updateScorecardControl(enabled: boolean): Promise<Response> {
  const { url, token } = controlConfig();
  return fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ enabled }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
}
