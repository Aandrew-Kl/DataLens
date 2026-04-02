export type ColumnType = "string" | "number" | "date" | "boolean" | "unknown";

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  nullCount: number;
  uniqueCount: number;
  sampleValues: (string | number | boolean | null)[];
  min?: number | string;
  max?: number | string;
  mean?: number;
  median?: number;
}

export interface DatasetMeta {
  id: string;
  name: string;
  fileName: string;
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  uploadedAt: number;
  sizeBytes: number;
}

export interface DatasetState {
  datasets: DatasetMeta[];
  activeDatasetId: string | null;
}
