# Press kit

Hero screenshots and brand assets for launch posts (HN, PH, Twitter, blog cross-posts).

## What's here

- `../../../public/og-image.png` (symlink target) — 1200×630 hero, use for OG cards and Product Hunt gallery.
- `../../../public/og-image.svg` — vector source for the hero, edit here then regenerate the PNG with:

  ```bash
  node -e "require('sharp')(require('fs').readFileSync('public/og-image.svg')).resize(1200,630).png().toFile('public/og-image.png')"
  ```

## TODO (capture after deploy agent lands)

The deploy agent provisions the live URL and can run a headless Playwright pass to capture these. Until then, they're placeholders referenced by `README.md` and the launch drafts.

- [ ] `01-sql-editor.png` — workspace with a non-trivial SQL query and a results table. Full width, 1920×1080 viewport cropped to the top of fold.
- [ ] `02-chart-builder.png` — chart builder panel open with a bar chart populated.
- [ ] `03-dashboard.png` — 3-4 tile dashboard in the grid.
- [ ] `04-ai-assistant.png` — AI panel open with a prompt and generated SQL.
- [ ] `05-sample-gallery.png` — first-run sample-datasets gallery.

Target location after capture: `docs-site/public/images/screenshots/` (referenced by the README screenshots section) with copies symlinked or duplicated here for the launch drafts.

## Capture command template

```bash
# Once the deploy URL is live:
BASE=<LIVE_URL>
npx playwright test --config=playwright.config.ts scripts/capture-screenshots.ts
# or (npm run script):
npm run screenshots
```

`scripts/capture-screenshots.ts` already exists in the repo as a `tsx` helper.
