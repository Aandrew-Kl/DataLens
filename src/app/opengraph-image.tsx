import { createOpenGraphImage } from "./_metadata-image";

export const alt = "DataLens — AI-Powered Data Explorer";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return createOpenGraphImage(size);
}
