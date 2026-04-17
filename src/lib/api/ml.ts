import { request } from "./client";
import type { RegressionResult, ClusterResult, ClassificationResult, AnomalyResult, PCAResult } from "./types";

export async function regression(
  data: Record<string, unknown>[],
  target: string,
  features: string[],
  method: string = "linear",
): Promise<RegressionResult> {
  return request<RegressionResult>("POST", "/api/ml/regression", {
    data,
    feature_columns: features,
    target_column: target,
    algorithm: method,
  });
}

export async function cluster(
  data: Record<string, unknown>[],
  features: string[],
  method: string = "kmeans",
  n_clusters: number = 3,
): Promise<ClusterResult> {
  return request<ClusterResult>("POST", "/api/ml/cluster", {
    data,
    feature_columns: features,
    algorithm: method,
    n_clusters,
  });
}

export async function classify(
  data: Record<string, unknown>[],
  target: string,
  features: string[],
  method: string = "random_forest",
): Promise<ClassificationResult> {
  return request<ClassificationResult>("POST", "/api/ml/classify", {
    data,
    feature_columns: features,
    target_column: target,
    algorithm: method,
  });
}

export async function anomalyDetect(
  data: Record<string, unknown>[],
  features: string[],
  method: string = "isolation_forest",
  contamination: number = 0.1,
): Promise<AnomalyResult> {
  return request<AnomalyResult>("POST", "/api/ml/anomaly-detect", {
    data,
    feature_columns: features,
    algorithm: method,
    contamination,
  });
}

export async function pca(
  data: Record<string, unknown>[],
  features: string[],
  n_components: number = 2,
): Promise<PCAResult> {
  return request<PCAResult>("POST", "/api/ml/pca", {
    data,
    feature_columns: features,
    n_components,
  });
}
