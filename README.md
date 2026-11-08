# FCP-R Profile

A web application version of the Functional Communication Profile - Revised
(FCP-R), built from the Google Form "Functional Communication Profile -
Revised (Digital)". It holds a student roster, multiple evaluations per
student, section-by-section entry in the form's own wording, a Level of
Impairment summary, a comparison view between two evaluations of the same
student, a printable profile report, and JSON and CSV export.

## Data stays on this device

All data is stored in the browser's local storage on the device where it is
entered. There is no account, no server, and no network transfer of student
data. Closing the browser does not erase data, but clearing browser storage
does. Export a JSON backup regularly from the roster screen.

Saves are only reported as successful after the write completes and reads
back. If a write fails, the app shows the failure instead of hiding it. A
warning appears when the stored data grows past 4 MB.

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
- `src/lib/` - store, persistence, answer logic, diff, and CSV code
- `src/data/fcpr-schema.json` - generated form schema (committed on purpose)
- `scripts/generate-schema.mjs` - the schema generator
- `tests/` - schema counts, store, and comparison tests, invented data only

## Scope notes

Version 0.1.0 converts the form field for field. It does not import existing
Google Form responses, and it does not generate a narrative report. The
printable report renders every field in section order, and the browser print
dialog is the PDF path.
