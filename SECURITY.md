# Security

## Data model

This app is local-only by design. Student records are stored in the browser's
local storage on the device where they are entered, under the key
`fcpr-store-v1`. The app has no server, no account system, and no analytics,
and it makes no network calls that carry student data.

Consequences to understand before real use:

- Anyone with unlocked access to the device and browser can read the records.
- Clearing browser storage deletes the records. Keep JSON backups in a place
  that matches your district's rules for student data.
- A JSON backup file holds the full record set in plain text. Treat it the
  same way you would treat a printed evaluation file.

## Reporting a problem

Report security problems to the repository owner through a private channel,
not in a public issue.

Never put real student data in an issue report, a pull request, a screenshot,
or a test file. No names, no birthdates, no answers, no exported backup files.
Describe the problem with invented example data only. Reports that contain
real student data will be removed and the data will need to be treated as
disclosed.

## Development rule

Tests and examples in this repository use invented students only. Real
student data does not belong in this codebase, its history, or its backups.
