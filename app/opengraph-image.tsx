import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";
export const alt = "Oath Logistics · Broker Portal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logoData = await readFile(join(process.cwd(), "public/oath-logo-white.png"));
  const logoBase64 = `data:image/png;base64,${logoData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #1a3a5c 0%, #080d16 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "32px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Actual Oath logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoBase64} alt="Oath Logistics" width={480} height={187} />
        {/* Subtitle */}
        <div
          style={{
            color: "#475569",
            fontSize: 26,
            letterSpacing: "10px",
            textTransform: "uppercase",
          }}
        >
          Broker Portal
        </div>
      </div>
    ),
    { ...size }
  );
}
