import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = normalizeBaseUrl(__ENV.BASE_URL || 'http://localhost:8000/api');
const REGISTER_PATH = normalizePath(__ENV.REGISTER_PATH || '/auth/register');
const LOGIN_PATH = normalizePath(__ENV.LOGIN_PATH || '/auth/login');
const QUERY_PATH = normalizePath(__ENV.QUERY_PATH || '/ai/generate-query');
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'StrongPass123!';
const QUESTION = __ENV.QUESTION || 'Show me the top 5 rows';
const TABLE_NAME = __ENV.TABLE_NAME || 'demo_rows';
const USE_OLLAMA = (__ENV.USE_OLLAMA || 'false').toLowerCase() === 'true';
const SAMPLE_DATA = [
  { id: 1, region: 'EMEA', revenue: 1240, orders: 12, category: 'hardware' },
  { id: 2, region: 'NA', revenue: 980, orders: 9, category: 'hardware' },
  { id: 3, region: 'APAC', revenue: 1430, orders: 14, category: 'software' },
  { id: 4, region: 'LATAM', revenue: 760, orders: 7, category: 'services' },
  { id: 5, region: 'EMEA', revenue: 1675, orders: 16, category: 'software' },
];
const REQUEST_BODY = JSON.stringify({
  question: QUESTION,
  table_name: TABLE_NAME,
  schema: { [TABLE_NAME]: Object.keys(SAMPLE_DATA[0]) },
  data: SAMPLE_DATA,
  use_ollama: USE_OLLAMA,
});

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)'],
  scenarios: {
    query_baseline: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 150,
      maxVUs: 300,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{endpoint:ai_generate_query}': ['p(95)<3000'],
    'http_req_failed{endpoint:ai_generate_query}': ['rate<0.01'],
  },
};

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function normalizePath(value) {
  return value.startsWith('/') ? value : `/${value}`;
}

function jsonParams(tags, extraHeaders = {}) {
  return {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    tags,
  };
}

function parseJson(response) {
  try {
    return response.json();
  } catch (_error) {
    return null;
  }
}

function maybeRegisterUser(email, password) {
  if (__ENV.AUTH_TOKEN || __ENV.TEST_EMAIL) {
    return;
  }

  const response = http.post(
    `${BASE_URL}${REGISTER_PATH}`,
    JSON.stringify({ email, password }),
    jsonParams({ endpoint: 'auth_register' }),
  );

  check(response, {
    'register returns 201': (r) => r.status === 201,
  });
}

function loginUser(email, password) {
  const response = http.post(
    `${BASE_URL}${LOGIN_PATH}`,
    JSON.stringify({ email, password }),
    jsonParams({ endpoint: 'auth_login' }),
  );
  const payload = parseJson(response);

  check(
    { response, payload },
    {
      'login returns 200': ({ response: res }) => res.status === 200,
      'login returns bearer token': ({ payload: body }) =>
        Boolean(body && body.access_token) && body.token_type === 'bearer',
    },
  );

  return payload ? payload.access_token : '';
}

// Rotate client IPs so the run measures query latency under load instead of
// collapsing into the backend's per-IP rate limiter.
function requestIp() {
  const second = ((__VU - 1) % 250) + 1;
  const third = (Math.floor(__ITER / 250) % 250) + 1;
  const fourth = (__ITER % 250) + 1;
  return `10.${second}.${third}.${fourth}`;
}

export function setup() {
  if (__ENV.AUTH_TOKEN) {
    return { token: __ENV.AUTH_TOKEN };
  }

  const email = __ENV.TEST_EMAIL || `k6-query-${Date.now()}@example.com`;
  maybeRegisterUser(email, TEST_PASSWORD);

  return {
    token: loginUser(email, TEST_PASSWORD),
  };
}

export default function (data) {
  const response = http.post(
    `${BASE_URL}${QUERY_PATH}`,
    REQUEST_BODY,
    jsonParams(
      { endpoint: 'ai_generate_query' },
      {
        Authorization: `Bearer ${data.token}`,
        'X-Forwarded-For': requestIp(),
      },
    ),
  );
  const payload = parseJson(response);

  check(
    { response, payload },
    {
      'query returns 200': ({ response: res }) => res.status === 200,
      'query returns sql': ({ payload: body }) => Boolean(body && body.sql),
      'query returns explanation': ({ payload: body }) => Boolean(body && body.explanation),
    },
  );
}
