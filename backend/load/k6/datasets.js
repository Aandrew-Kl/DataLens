import http from 'k6/http';
import { check, fail, sleep } from 'k6';

const BASE_URL = normalizeBaseUrl(__ENV.BASE_URL || 'http://localhost:8000/api');
const REGISTER_PATH = normalizePath(__ENV.REGISTER_PATH || '/auth/register');
const LOGIN_PATH = normalizePath(__ENV.LOGIN_PATH || '/auth/login');
const DATASET_UPLOAD_PATH = normalizePath(__ENV.DATASET_UPLOAD_PATH || '/datasets/upload');
const DATASETS_PATH = normalizeCollectionPath(__ENV.DATASETS_PATH || '/datasets/');
const SAMPLE_CSV = open('./data/sample.csv', 'b');
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'StrongPass123';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '2m', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function normalizePath(value) {
  return value.startsWith('/') ? value : `/${value}`;
}

function normalizeCollectionPath(value) {
  const normalized = normalizePath(value);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function parseJson(response, context) {
  try {
    return response.json();
  } catch (error) {
    fail(`${context} returned invalid JSON: ${error}`);
  }
}

function jsonParams(tags) {
  return {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    tags,
  };
}

function authParams(token, tags) {
  return {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    tags,
  };
}

function maybeRegisterUser(email, password) {
  if (__ENV.TEST_EMAIL) {
    return;
  }

  const response = http.post(
    `${BASE_URL}${REGISTER_PATH}`,
    JSON.stringify({ email, password }),
    jsonParams({ endpoint: 'auth_register' }),
  );

  const ok = check(response, {
    'register returns 201': (r) => r.status === 201,
  });

  if (!ok) {
    fail(`register failed with ${response.status}: ${response.body}`);
  }
}

function loginUser(email, password) {
  const response = http.post(
    `${BASE_URL}${LOGIN_PATH}`,
    JSON.stringify({ email, password }),
    jsonParams({ endpoint: 'auth_login' }),
  );

  const ok = check(response, {
    'login returns 200': (r) => r.status === 200,
    'login returns bearer token': (r) => {
      const payload = parseJson(r, 'login');
      return Boolean(payload.access_token) && payload.token_type === 'bearer';
    },
  });

  if (!ok) {
    fail(`login failed with ${response.status}: ${response.body}`);
  }

  return parseJson(response, 'login').access_token;
}

function uploadDataset(token, datasetName) {
  const response = http.post(
    `${BASE_URL}${DATASET_UPLOAD_PATH}`,
    {
      name: datasetName,
      file: http.file(SAMPLE_CSV, 'sample.csv', 'text/csv'),
    },
    authParams(token, { endpoint: 'datasets_upload' }),
  );

  const ok = check(response, {
    'upload returns 201': (r) => r.status === 201,
    'upload returns dataset id': (r) => Boolean(parseJson(r, 'upload dataset').id),
  });

  if (!ok) {
    fail(`dataset upload failed with ${response.status}: ${response.body}`);
  }

  return parseJson(response, 'upload dataset');
}

function listDatasets(token, expectedId) {
  const response = http.get(
    `${BASE_URL}${DATASETS_PATH}`,
    authParams(token, { endpoint: 'datasets_list' }),
  );

  const ok = check(response, {
    'list returns 200': (r) => r.status === 200,
    'list includes uploaded dataset': (r) => {
      const payload = parseJson(r, 'list datasets');
      return Array.isArray(payload) && payload.some((dataset) => dataset.id === expectedId);
    },
  });

  if (!ok) {
    fail(`dataset list failed with ${response.status}: ${response.body}`);
  }
}

function getDataset(token, datasetId) {
  const response = http.get(
    `${BASE_URL}${DATASETS_PATH}${datasetId}`,
    authParams(token, { endpoint: 'datasets_get' }),
  );

  const ok = check(response, {
    'get returns 200': (r) => r.status === 200,
    'get returns requested dataset': (r) => parseJson(r, 'get dataset').id === datasetId,
  });

  if (!ok) {
    fail(`dataset get failed with ${response.status}: ${response.body}`);
  }
}

export function setup() {
  const email = __ENV.TEST_EMAIL || `k6-datasets-${Date.now()}@example.com`;
  maybeRegisterUser(email, TEST_PASSWORD);

  return {
    token: loginUser(email, TEST_PASSWORD),
  };
}

export default function (data) {
  const datasetName = `dataset-${__VU}-${__ITER}`;
  const uploadedDataset = uploadDataset(data.token, datasetName);

  listDatasets(data.token, uploadedDataset.id);
  getDataset(data.token, uploadedDataset.id);

  sleep(1);
}
