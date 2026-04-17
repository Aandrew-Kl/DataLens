import { request } from "@/lib/api/client";
import { anomalyDetect, classify, cluster, pca, regression } from "@/lib/api/ml";

jest.mock("@/lib/api/client", () => ({
  request: jest.fn(),
}));

const mockedRequest = jest.mocked(request);

describe("ml API", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  const data = [
    { feature_a: 1, feature_b: 10, target: 100, label: "positive" },
    { feature_a: 2, feature_b: 20, target: 200, label: "negative" },
  ];

  test.each([
    {
      name: "regression",
      invoke: () => regression(data, "target", ["feature_a", "feature_b"], "ridge"),
      path: "/api/ml/regression",
      payload: {
        data,
        target_column: "target",
        feature_columns: ["feature_a", "feature_b"],
        algorithm: "ridge",
      },
      response: {
        algorithm: "ridge",
        row_count: 2,
        metrics: {
          r2: 0.98,
          rmse: 0.12,
          cv_scores: [0.95, 0.97],
          cv_mean: 0.96,
          cv_std: 0.01,
        },
        coefficients: { feature_a: 0.7, feature_b: 0.3 },
        intercept: 1.5,
        residuals: [0.1, -0.1],
        predictions: [100, 200],
      },
    },
    {
      name: "cluster",
      invoke: () => cluster(data, ["feature_a", "feature_b"], "dbscan", 5),
      path: "/api/ml/cluster",
      payload: {
        data,
        feature_columns: ["feature_a", "feature_b"],
        algorithm: "dbscan",
        n_clusters: 5,
      },
      response: {
        algorithm: "dbscan",
        row_count: 2,
        labels: [0, 1],
        cluster_centers: [{ feature_a: 1, feature_b: 10 }, { feature_a: 2, feature_b: 20 }],
        cluster_sizes: { "0": 1, "1": 1 },
        silhouette_score: 0.81,
      },
    },
    {
      name: "classify",
      invoke: () => classify(data, "label", ["feature_a", "feature_b"], "svm"),
      path: "/api/ml/classify",
      payload: {
        data,
        target_column: "label",
        feature_columns: ["feature_a", "feature_b"],
        algorithm: "svm",
      },
      response: {
        algorithm: "svm",
        row_count: 2,
        class_labels: ["negative", "positive"],
        metrics: {
          accuracy: 0.92,
          precision: 0.9,
          recall: 0.93,
          f1: 0.91,
        },
        confusion_matrix: [[8, 1], [0, 9]],
        classification_report: { positive: { precision: 0.9 } },
        predictions: ["positive", "negative"],
      },
    },
    {
      name: "anomalyDetect",
      invoke: () => anomalyDetect(data, ["feature_a", "feature_b"], "lof", 0.2),
      path: "/api/ml/anomaly-detect",
      payload: {
        data,
        feature_columns: ["feature_a", "feature_b"],
        algorithm: "lof",
        contamination: 0.2,
      },
      response: {
        algorithm: "lof",
        row_count: 2,
        labels: [1, -1],
        anomaly_scores: [0.02, 0.87],
        anomaly_count: 1,
      },
    },
    {
      name: "pca",
      invoke: () => pca(data, ["feature_a", "feature_b"], 3),
      path: "/api/ml/pca",
      payload: {
        data,
        feature_columns: ["feature_a", "feature_b"],
        n_components: 3,
      },
      response: {
        row_count: 2,
        explained_variance_ratio: [0.7, 0.2, 0.1],
        loadings: [
          { component: "PC1", feature_a: 0.8, feature_b: 0.2 },
          { component: "PC2", feature_a: 0.1, feature_b: 0.9 },
          { component: "PC3", feature_a: 0.3, feature_b: 0.7 },
        ],
        transformed_data: [[1, 0, 0], [0, 1, 0]],
      },
    },
  ])("calls the $name endpoint with the correct params and returns the parsed response", async ({
    invoke,
    path,
    payload,
    response,
  }) => {
    mockedRequest.mockResolvedValue(response);

    await expect(invoke()).resolves.toEqual(response);

    expect(mockedRequest).toHaveBeenCalledWith("POST", path, payload);
  });
});
