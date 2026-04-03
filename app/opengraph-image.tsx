import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Oath Logistics · Broker Portal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
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
          fontFamily: "sans-serif",
        }}
      >
        {/* Gold O ring */}
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: "50%",
            border: "18px solid #f59e0b",
            marginBottom: 44,
            boxShadow: "0 0 60px rgba(245,158,11,0.45)",
          }}
        />
        {/* Title */}
        <div
          style={{
            color: "white",
            fontSize: 80,
            fontWeight: 800,
            letterSpacing: "-3px",
            lineHeight: 1,
          }}
        >
          Oath Logistics
        </div>
        {/* Subtitle */}
        <div
          style={{
            color: "#475569",
            fontSize: 28,
            marginTop: 20,
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
