# ExamGuard Desktop

ExamGuard is a standalone Electron app with a
React/Vite renderer styled with Tailwind CSS 4. It is separate from the UniCORE
frontend and backend repositories.

Students launch ExamGuard from an eligible exam detail page in UniCORE. The
website requests the existing short-lived, single-use launch ticket and opens
the `examguard://launch?ticket=...` protocol. The trusted Electron main process
validates the link and redeems the ticket; renderer code does not receive it.
The existing ExamGuard session then starts or resumes the server-authoritative
exam attempt. Exams requiring Safe Exam Browser remain blocked in ExamGuard.
ExamGuard does not provide OS-level lockdown.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A desktop environment supported by Electron

## Install

From this directory:

```sh
npm install
```

## Development

Start Vite and Electron together:

```sh
npm run dev
```

The development renderer is served on the local machine. The Electron window
uses a sandboxed renderer with Node integration disabled and context isolation
enabled.

## Lint and production build

```sh
npm run lint
npm run build
```

`npm run build` builds the Electron main process, preload, and production
renderer into `out/`.

## Package the desktop app

Package for the current host:

```sh
npm run package
```

Platform-specific scripts:

```sh
npm run package:linux
npm run package:windows
npm run package:macos
```

Each packaging command first validates that `config/production.json` has a
non-empty HTTPS UniCORE API URL. With the current blank configuration, release
packaging is intentionally blocked.

Cross-platform packaging may require a platform-appropriate host or additional
system tooling. Distributables are written to `release/`.

## API configuration

The non-secret API base URL is configured separately for development and
packaged builds:

- `config/development.json` is used only by an unpackaged development run. Its
  default points to the local UniCORE API.
- `config/production.json` is included as a resource in packaged builds and
  accepts HTTPS URLs only. Set the HTTPS endpoint including `/api` or
  `/api/v1` before packaging a production build.

The main process validates the URL and keeps API requests inside a dedicated
Electron session. The preload exposes only fixed ticket/session operations,
not the API URL or a generic request method. These files must contain only a
base URL; never put credentials, access tokens, refresh tokens, or other
secrets in them. Production configuration must be confirmed before packaging.

## Security boundaries in this foundation

- `contextIsolation`, `sandbox`, and `webSecurity` are enabled.
- `nodeIntegration` and insecure content are disabled.
- The preload exposes only fixed ticket, session, answer, code-run, proctoring,
  and status operations; it has no generic IPC, filesystem, shell, or
  navigation API.
- Popups are denied. Navigation is limited to the local development origin or
  the packaged renderer entry file.
- Website launches now use the registered `examguard` protocol. The ticket is a
  temporary bearer value in the OS protocol handoff and is redeemed by the
  main process without forwarding it to the renderer. Manual ticket entry
  remains available as a recovery path. Tickets expire after 60 seconds,
  are single-use, and are never written to local storage.
- ExamGuard launch is rejected for exams requiring Safe Exam Browser.
- Camera access is allowed only for the trusted main window, and only when the
  active exam requires camera monitoring. Microphone access is never granted.
- Camera-required exams show a preview, send heartbeats every 12 seconds, and
  send JPEG snapshots every 30 seconds through UniCORE's existing proctor
  endpoint. UniCORE remains responsible for access and retention policy.
- Fullscreen-required exams run fullscreen; minimize and focus/fullscreen faults
  are sent to UniCORE's existing fault endpoint. Configured copy, paste, and
  context-menu restrictions are enforced in the Electron window. This is not an
  OS kiosk or managed-browser lock; exams requiring `browserLock` or microphone
  monitoring are rejected.
- Programming runs are available only for a coding question's allowed
  Python/JavaScript/C/C++/C# languages, only during an active authorized
  attempt. The backend runner uses a fresh, networkless, read-only-root
  container with an unprivileged user, dropped capabilities, resource limits,
  and bounded logs. The actual Docker sandbox image/runtime must still be
  verified in the deployed environment.

## Release readiness

There are no published Windows, macOS, or Linux installers in this repository.
`release/linux-unpacked/` is an unpacked development/package output, not an
installer. The website must not advertise a download link until a real,
tested installer is published.

The packaged API endpoint in `config/production.json` is currently blank.
Configure it to the HTTPS UniCORE API before packaging any production
installer. Production API integration, signing/notarization, installer
installation, and protocol registration still require release testing on each
target operating system.

## Exam question support

The desktop session reuses the UniCORE start/resume, autosave, submission, and
status APIs. It supports multiple-choice, true/false, essay, and coding
responses with allowed-language tabs, starter code, question images, hints,
and student-visible design materials/schema. Exam-scoped code execution is
available for the supported languages above. Interactive Linux terminal,
Windows-specific labs, networking simulators, and design canvases are not
implemented; those lab types currently accept written responses only.

## Existing project assets

The form uses the existing round ExamGuard icon at
`images/07_icon_only_round.png`; project assets remain in place.
