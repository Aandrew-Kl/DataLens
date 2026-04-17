# Screenshot Capture

The capture flow starts a local dev server in demo mode, loads sample data, and writes screenshots into `docs-site/public/images/screenshots/`.

- `DATALENS_DEMO_MODE` is set automatically by the script.
- Output directory: `docs-site/public/images/screenshots/`
- Run with `npm run screenshots`
- Expect roughly 2-3 minutes end-to-end

Notes:

- The script boots `npm run dev`, waits for the app to respond, then drives Chromium through the main workspace routes.
- It keeps going if one screenshot fails and exits with code `1` if any capture did not succeed.
- Existing screenshots are overwritten in place.
