# Changelog

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
