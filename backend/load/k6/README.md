# k6 backend load scripts

These scripts exercise the authenticated backend REST surface with a ramp from 0 to 20 VUs over 30 seconds, a 2 minute hold, and a 30 second ramp down.

## Usage

From the repository root:

```sh
BASE_URL=http://localhost:8000/api k6 run backend/load/k6/auth.js
BASE_URL=http://localhost:8000/api k6 run backend/load/k6/datasets.js
```

`BASE_URL` should point at the backend API prefix. The default in both scripts is `http://localhost:8000/api`.

`auth.js` performs the required login coverage in `setup()` and on the first iteration of four VUs. That keeps the run under the backend's current `5/minute` login limiter while still exercising `POST /auth/login` during execution.

## What the scripts hit

- `POST /auth/login`
- `POST /datasets/upload`
- `GET /datasets/`
- `GET /datasets/:id`

The backend currently creates datasets through `/datasets/upload`. If your deployment exposes dataset creation on a different path, override it with `DATASET_UPLOAD_PATH`.

## Test data

The upload payload comes from `backend/load/k6/data/sample.csv`.

## Optional environment variables

- `TEST_EMAIL`: use an existing user instead of auto-registering a per-run test user
- `TEST_PASSWORD`: password for `TEST_EMAIL` or the auto-created user
- `DATASET_UPLOAD_PATH`: override the dataset upload route if needed
- `LOGIN_PATH`: override the login route if needed
- `REGISTER_PATH`: override the registration route if needed
