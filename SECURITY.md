# Security

## Supported versions

Only the latest build from the master branch is supported. This app is
not deployed yet and has no Android app or other editions. When a build
is published, the supported version is the one that build serves.

## Reporting a vulnerability

Email the repository owner at devinllewis+git@pm.me with:

- A description of the problem and what it puts at risk
- Steps to reproduce, using invented example data only
- The browser and version where you saw it, if it is browser specific

Rules for every report:

- Never include real student data in a report. No names, no birthdates,
  no answers, no screenshots of real records, and no backup files.
  Describe the problem with invented example data. A report that carries
  real student data will be removed, and the data in it will need to be
  treated as disclosed.
- Do not disclose the problem publicly until a fix is out.
- Credit is given in the changelog on request.

## Scope

In scope: the web app in this repository, its storage and encryption
code, its backup import and export, and the static build output.

Out of scope: the browser and device the app runs on, any hosting
account used to serve a build, and copies of exported backup files after
they leave the app.

## What the app does with your data

This app is local-only by design. Student records are stored in
IndexedDB on the device where they are entered. The app has no server,
no account system, and no analytics, and it makes no network calls that
carry student data.

Consequences to understand before real use:

- Anyone with unlocked access to the device and browser can read
  records that are not passcode protected. Turn on passcode protection
  for records on shared or portable devices.
- Passcode protection encrypts records at rest on the device. It does
  not protect records while the app is unlocked, and it does not
  protect printed reports or exported files.
- Clearing browser data deletes the records. Keep backups in a place
  that matches your district rules for student data.
- A plain JSON backup holds the full record set in readable text. Treat
  it the same way you would treat a printed evaluation file, or use a
  password-protected backup instead.

## Security practices

- Passcode encryption at rest uses AES-256-GCM. A random data key
  encrypts the data. The data key is wrapped under a key derived from
  the passcode with PBKDF2-SHA-256 at 600,000 iterations and a random
  salt. A one-time recovery key, shown once at setup, wraps a second
  copy of the data key and can unlock the store and reset the passcode.
- Passcode protection is offered on first run, with an explicit choice
  to run without it. Existing data is never locked away by an upgrade: a
  store written by an earlier version migrates to IndexedDB in plain
  form and stays readable.
- Password-protected backups use the same AES-256-GCM and PBKDF2
  machinery, with the password set at export time.
- Repeated failed unlock attempts trigger a lockout that grows with
  each round of failures. The failure state is stored outside the
  encrypted payload, so reloading the app does not reset it.
- A save is reported successful only after the storage write completes
  and reads back. Write failures are shown in the app, not hidden.
- The static build ships a strict Content-Security-Policy and security
  headers through public/_headers, including frame denial, no
  referrer, HSTS, and a restrictive Permissions-Policy.
- Dependabot watches the npm dependencies monthly with grouped minor
  and patch pull requests (.github/dependabot.yml).

## Development rule

Tests and examples in this repository use invented students only. Real
student data does not belong in this codebase, its history, or its
backups.
