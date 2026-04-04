import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DataLens",
    short_name: "DataLens",
    description: "AI-powered data explorer",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0891b2",
    icons: [
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
