# Changelog

## Unreleased

Cloudflare deployment setup.

Included:

- Cloudflare Workers Static Assets deploy route: `wrangler.toml` names
  the worker `fcp-r-profile` and serves the static export in `out/`
  with single-page-application handling for unknown paths.
- `wrangler` added as a devDependency (Wrangler v4), plus a `deploy`
  script in `package.json` that runs `next build && wrangler deploy`.
- The app is live at https://fcp-r-profile.devinllewis-git.workers.dev.
  The deploy is a direct deploy of the local tree, not a Git
  connection, so redeploys are manual. Rerun the deploy command after
  the local tree matches the repo.

## 2026-11-08 - v0.2.0

Security and structure parity with AscendEd DataTool.

Included:

- Storage moved from local storage (key `fcpr-store-v1`) to IndexedDB. On
  first run, an existing local storage store migrates to IndexedDB, is
  read back and verified, and only then is the local storage copy
  removed. A failed migration keeps the local storage copy and shows an
  error. Existing records stay readable and are never locked away by
  this upgrade.
- Passcode Protection, in the AscendEd pattern:
  - Offered on first run, with an explicit choice to run without a
    passcode. Setup never blocks access to the app.
  - When on, records are encrypted at rest in IndexedDB with
    AES-256-GCM. A random data key encrypts the data, and the data key
    is wrapped under a key derived from the passcode with PBKDF2-SHA-256
    at 600,000 iterations and a random salt. The data key is held in
    memory only.
  - A one-time recovery key is generated at setup and shown once. It
    can unlock the store and set a new passcode.
  - Settings holds controls to turn protection on, change the passcode,
    remove the passcode (which stores records in plain form again), and
    lock the app immediately.
  - Failed unlock attempts are counted outside the encrypted payload.
    Five failures trigger a timed lockout that grows with each round of
    failures and survives a reload.
  - Saves complete their IndexedDB write and a read-back check before
    the app reports success. Write failures are shown, not hidden.
- Password-protected backups: export can encrypt the backup with a
  password set at export time, using the same AES-256-GCM and PBKDF2
  machinery. Import accepts plain and encrypted backups, detects which
  it has, asks for the password when one is needed, and keeps the
  validate-then-confirm replacement flow. A wrong password gives a
  clear error and changes nothing.
- The in-app data panel is now a Privacy Notice in plain language: data
  on this device only, what the passcode does and does not do, the
  recovery key warning, and backup guidance.
- `public/_headers` ships the AscendEd security header set for static
  hosting: a strict Content-Security-Policy, frame denial,
  X-Content-Type-Options, no referrer, HSTS, a restrictive
  Permissions-Policy, noindex, and immutable caching for fingerprinted
  static assets. The AscendEd service worker cache rule is omitted
  because this app has no service worker.
- `SECURITY.md` rewritten in the AscendEd structure: supported
  versions, vulnerability reporting (with a hard rule against real
  student data in reports), scope, data handling, and security
  practices.
- `.github/dependabot.yml` added: npm ecosystem, monthly, grouped
  minor and patch updates.
- Tests added for the cryptography round trip and wrong passcode, the
  recovery key unlock and passcode reset path, the local storage to
  IndexedDB migration, the unlock lockout, and the encrypted backup
  round trip and wrong password path.

Known limits:

- The passcode protects records at rest on this device only. It does
  not protect records while the app is unlocked, printed reports, or
  exported files, and it cannot stop someone from clearing browser data
  and deleting the records.
- If both the passcode and the recovery key are lost, encrypted records
  cannot be opened. There is no reset path by design.
- All earlier limits still apply: no import of existing Google Form
  responses, and CSV export expands grids one row per grid row with
  multi-select answers joined by semicolons.

## 2026-11-08 - v0.1.0

First version. Built from the Google Form "Functional Communication Profile -
Revised (Digital)" (161 items, 147 questions or groups, 13 sections).

Included:

- Student roster: add, edit, and delete students with name, birthdate, and notes
- Multiple evaluations per student, with Evaluation Type and date seeded from
  the form's own first section
- Section-by-section entry for all 13 form sections, rendered from a generated
  schema (`scripts/generate-schema.mjs` writes `src/data/fcpr-schema.json`),
  with per-section and overall completion counts
- Question rendering by type: checkbox multi-select with Other free text,
  radio single-select with Other free text, short text, paragraph text, and
  grids (radio per row or checkbox per row, matching each grid in the form)
- Autosave to local storage under the versioned key `fcpr-store-v1`, with
  read-back verification and visible save failures, plus a size warning past
  4 MB of stored data
- Evaluation status: in progress or complete, resumable at any time
- Level of Impairment summary: the 11 rated areas shown as a dot plot in
  severity order from Normal to Profound
- Comparison view: pick two evaluations of one student and see only the
  changed fields, grouped by section, with a toggle to show all fields
- Printable report: one evaluation rendered field for field in section order,
  with print CSS and no navigation chrome. Browser print is the PDF path
- Backup: full store export and import as JSON, with shape validation,
  a clear refusal of malformed files, and a confirmation before replacement
- Single evaluation export as CSV
- In-app panel explaining that data lives only on this device

Known limits:

- No import of existing Google Form responses. Data starts clean.
- CSV export expands each grid into one row per grid row, and joins
  multi-select answers with semicolons inside the answer cell.
- Local storage is per browser and per device. Records do not sync between
  devices. Use JSON export and import to move data.
- The schema is generated from the extracted form JSON. If the Google Form
  changes, the extraction must be refreshed before regeneration reflects it.
