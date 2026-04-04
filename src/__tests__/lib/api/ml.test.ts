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
      path: "/api/v1/ml/regression",
      payload: {
        data,
        target: "target",
        features: ["feature_a", "feature_b"],
        method: "ridge",
      },
      response: {
        r2: 0.98,
        rmse: 0.12,
        coefficients: { feature_a: 0.7, feature_b: 0.3 },
        intercept: 1.5,
        method: "ridge",
      },
    },
    {
      name: "cluster",
      invoke: () => cluster(data, ["feature_a", "feature_b"], "dbscan", 5),
      path: "/api/v1/ml/cluster",
      payload: {
        data,
        features: ["feature_a", "feature_b"],
        method: "dbscan",
        n_clusters: 5,
      },
      response: {
        labels: [0, 1],
        centers: [[1, 10], [2, 20]],
        silhouette_score: 0.81,
        method: "dbscan",
      },
    },
    {
      name: "classify",
      invoke: () => classify(data, "label", ["feature_a", "feature_b"], "svm"),
      path: "/api/v1/ml/classify",
      payload: {
        data,
        target: "label",
        features: ["feature_a", "feature_b"],
        method: "svm",
      },
      response: {
        accuracy: 0.92,
        precision: 0.9,
        recall: 0.93,
        f1: 0.91,
        confusion_matrix: [[8, 1], [0, 9]],
        feature_importance: { feature_a: 0.55, feature_b: 0.45 },
      },
    },
    {
      name: "anomalyDetect",
      invoke: () => anomalyDetect(data, ["feature_a", "feature_b"], "lof", 0.2),
      path: "/api/v1/ml/anomaly-detect",
      payload: {
        data,
        features: ["feature_a", "feature_b"],
        method: "lof",
        contamination: 0.2,
      },
      response: {
        labels: [1, -1],
        scores: [0.02, 0.87],
      },
    },
    {
      name: "pca",
      invoke: () => pca(data, ["feature_a", "feature_b"], 3),
      path: "/api/v1/ml/pca",
      payload: {
        data,
        features: ["feature_a", "feature_b"],
        n_components: 3,
      },
      response: {
        explained_variance: [0.7, 0.2, 0.1],
        loadings: [[0.8, 0.2], [0.1, 0.9], [0.3, 0.7]],
        transformed: [[1, 0, 0], [0, 1, 0]],
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
