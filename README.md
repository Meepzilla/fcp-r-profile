# FCP-R Profile

A web application version of the Functional Communication Profile - Revised
(FCP-R), built from the Google Form "Functional Communication Profile -
Revised (Digital)". It holds a student roster, multiple evaluations per
student, section-by-section entry in the form's own wording, a Level of
Impairment summary, a comparison view between two evaluations of the same
student, a printable profile report, and JSON and CSV export.

## Privacy and safety

All data is stored on the device where it is entered, in the browser's
IndexedDB storage. There is no account, no server, and no network transfer
of student data. Closing the browser does not erase data, but clearing
browser data does. Export a backup regularly from the roster screen.

Storage and protection, in the pattern used by AscendEd DataTool:

- Records live in IndexedDB, not in a whole-blob local storage entry. A
  store written by version 0.1.x in local storage migrates to IndexedDB on
  first run of this version. The old copy is removed only after the new
  copy is verified, and a failed migration keeps the old copy and shows
  an error.
- Passcode protection is offered on first run, with an explicit choice
  to run without it. When it is on, records are encrypted at rest with
  AES-256-GCM. A random data key encrypts the data, and the data key is
  wrapped under a key derived from the passcode with PBKDF2-SHA-256 at
  600,000 iterations and a random salt. The data key is held in memory
  only while the app is unlocked.
- A one-time recovery key is generated at setup and shown once. It can
  unlock the store and reset a forgotten passcode. It cannot be shown
  again, so it has to be stored somewhere separate from the device.
- Repeated failed unlock attempts trigger a lockout that grows with
  each round of failures, and the lockout state survives a reload.
- Backups come in two forms: a plain JSON file, and a password-protected
  backup encrypted with the same AES-256-GCM and PBKDF2 machinery, using
  a password set at export time. Import accepts both and asks for the
  password when a file is encrypted.
- The static build ships security headers from `public/_headers`,
  including a strict Content-Security-Policy, frame denial, HSTS, no
  referrer, and a restrictive Permissions-Policy.
- Dependabot configuration lives in `.github/dependabot.yml` (npm,
  monthly, grouped minor and patch updates).

Saves are only reported as successful after the write completes and reads
back. If a write fails, the app shows the failure instead of hiding it. A
warning appears when the stored data grows past 4 MB.

See [SECURITY.md](SECURITY.md) for supported versions, how to report a
vulnerability, and the full list of security practices.

## Run it locally

```bash
npm install
npm run dev
```

Open the local address the dev server prints.

## Build the static site

```bash
npm run build
```

The static site is written to `out/` and can be hosted on any static host.

## Deploy to Cloudflare

The live site runs on Cloudflare Workers Static Assets at
https://fcp-r-profile.devinllewis-git.workers.dev. The `wrangler.toml`
config serves the static export in `out/`.

```bash
npm run deploy
```

The deploy is a direct deploy of the local tree, not a Git connection.
Redeploys are manual: rerun the command after the local tree matches the
repo.

## Check the code

```bash
npm run typecheck
npm run lint
npm test
```

## Regenerate the form schema

The evaluation form is rendered from a generated schema, not hand-written
markup. The schema comes from the extracted Google Form JSON kept one folder
up from this repo.

```bash
npm run generate-schema
```

That runs `scripts/generate-schema.mjs`, reads `../form-digital.json`, and
writes `src/data/fcpr-schema.json`. If the source form changes, replace the
extracted JSON, regenerate, and run the tests. The schema test asserts 13
sections, 147 questions or groups, and the Level of Impairment grid at 11
rows by 6 columns.

To generate from a different extraction, set `FCPR_FORM_JSON` to its path.

## Layout

- `src/app/` - the single-page app shell, styles, and print CSS
- `src/components/` - question fields, impairment summary, comparison, print report
- `src/lib/` - store, IndexedDB persistence, passcode cryptography, backup handling, answer logic, diff, and CSV code
- `public/_headers` - security headers for static hosting
- `.github/dependabot.yml` - monthly grouped npm update pull requests
- `src/data/fcpr-schema.json` - generated form schema (committed on purpose)
- `scripts/generate-schema.mjs` - the schema generator
- `tests/` - schema counts, store, and comparison tests, invented data only

## Scope notes

Version 0.1.0 converts the form field for field. It does not import existing
Google Form responses, and it does not generate a narrative report. The
printable report renders every field in section order, and the browser print
dialog is the PDF path.
