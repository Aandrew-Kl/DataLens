import { ImageResponse } from "next/og";

type ImageSize = {
  width: number;
  height: number;
};

const BRAND_CYAN = "#0891b2";
const BRAND_CYAN_LIGHT = "#22d3ee";
const BRAND_CYAN_DARK = "#0e7490";
const WHITE = "#ffffff";

export function createMonogramImage(size: ImageSize) {
  const dimension = Math.min(size.width, size.height);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BRAND_CYAN,
          color: WHITE,
          fontFamily: "sans-serif",
          fontSize: Math.round(dimension * 0.62),
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: `-${Math.max(1, Math.round(dimension * 0.04))}px`,
        }}
      >
        D
      </div>
    ),
    size
  );
}

export function createOpenGraphImage(size: ImageSize) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          backgroundImage: `linear-gradient(135deg, ${BRAND_CYAN_LIGHT} 0%, ${BRAND_CYAN} 55%, ${BRAND_CYAN_DARK} 100%)`,
          color: WHITE,
          fontFamily: "sans-serif",
          padding: "72px 84px",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at top right, rgba(255,255,255,0.18), transparent 34%), radial-gradient(circle at bottom left, rgba(255,255,255,0.12), transparent 28%)",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 24,
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 96,
              height: 96,
              borderRadius: 24,
              backgroundColor: "rgba(255,255,255,0.14)",
              border: "2px solid rgba(255,255,255,0.2)",
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-4px",
            }}
          >
            D
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div
              style={{
                fontSize: 92,
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-4px",
              }}
            >
              DataLens
            </div>
            <div
              style={{
                fontSize: 40,
                fontWeight: 500,
                lineHeight: 1.2,
                opacity: 0.95,
              }}
            >
              AI-Powered Data Explorer
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
