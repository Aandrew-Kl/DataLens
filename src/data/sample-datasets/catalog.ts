import manifest from "./manifest.json";

export interface SampleDataset {
  slug: string;
  fileName: string;
  title: string;
  description: string;
  tableName: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
  previewRows: Array<Record<string, string>>;
}

interface SampleDatasetManifest {
  seed: number;
  datasets: SampleDataset[];
}

const typedManifest = manifest as SampleDatasetManifest;

export const SAMPLE_DATASET_SEED = typedManifest.seed;
export const SAMPLE_DATASETS = typedManifest.datasets;
export const SAMPLE_DATASET_FILE_NAMES = new Set(
  SAMPLE_DATASETS.map((dataset) => dataset.fileName),
);

export function getSampleDataset(fileName: string) {
  return SAMPLE_DATASETS.find((dataset) => dataset.fileName === fileName) ?? null;
}
