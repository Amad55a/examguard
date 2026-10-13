# ExamGuard Desktop

ExamGuard is a standalone Electron app with a
React/Vite renderer styled with Tailwind CSS 4. It is separate from the UniCORE
frontend and backend repositories.

Students launch ExamGuard from an eligible exam detail page in UniCORE. The
website requests the existing short-lived, single-use launch ticket and opens
the `unicore-exam://launch?ticket=...` protocol (with a legacy
`examguard://launch?ticket=...` compatibility alias retained for older installs).
The trusted Electron main process validates the link and redeems the ticket;
renderer code does not receive it. The existing ExamGuard session then starts or
resumes the server-authoritative exam attempt. Exams requiring Safe Exam Browser
remain blocked in ExamGuard. ExamGuard does not provide OS-level lockdown.

## Requirements and supported builds

- Node.js 22 or newer and npm 10 or newer
- Ubuntu/Linux x86_64 for the tested build target
- A graphical Linux desktop; ExamGuard is not a headless or OS-managed kiosk app

Version `0.1.0` is the current development version. Linux x86_64 is the only
configured and locally verified packaging target. Windows and macOS installers
are not built or supported by this release workflow.

## Install

From this directory:

```sh
npm ci
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

Build a Linux x86_64 AppImage and Debian package, then write SHA-256 checksums:

```sh
npm run package:linux
```

Packaging first validates that `config/production.json` contains the
non-secret HTTPS UniCORE API URL. Output files are placed in `release/`:

- `ExamGuard-0.1.0.AppImage`
- `examguard-desktop_0.1.0_amd64.deb`
- `SHA256SUMS.txt`

Install the Debian package on Ubuntu with:

```sh
sudo apt install ./release/examguard-desktop_0.1.0_amd64.deb
```

Or run the AppImage without installing:

```sh
chmod +x release/ExamGuard-0.1.0.AppImage
./release/ExamGuard-0.1.0.AppImage
```

Verify the locally generated installers with:

```sh
cd release
sha256sum -c SHA256SUMS.txt
```

These are local build outputs, not a published or institution-approved
production release. Run the checks and test protocol registration on the target
Ubuntu desktop before distributing them.

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
  status, and UniCORE portal-opening operations; it has no generic IPC,
  filesystem, shell, or arbitrary-URL navigation API.
- Popups are denied. Navigation is limited to the local development origin or
  the packaged renderer entry file.
- Website launches use `unicore-exam://launch?ticket=...`; ExamGuard registers
  that scheme and the legacy `examguard` scheme. The ticket is a temporary
  bearer value in the OS protocol handoff and is redeemed by the main process
  without forwarding it to the renderer. The portal does not retry the same
  ticket under a second scheme. Manual ticket entry remains available as a
  recovery path. Tickets expire after 60 seconds, are single-use, and are never
  written to local storage.
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

There are no published releases or downloadable installers yet. The
`release/` directory contains ignored local build outputs only. The website
must not advertise a download link until a real, tested installer is published.
The current release workflow builds Linux x86_64 only and attaches the AppImage,
Debian package, and SHA-256 sums when a matching version tag is pushed.
After reviewing and committing only the intended release changes, publish
version `0.1.0` by tagging that reviewed commit and pushing the tag:

```sh
git tag v0.1.0 <reviewed-commit>
git push origin v0.1.0
```

The workflow creates the GitHub release only after the Linux build, lint, and
tests pass. Confirm the release assets are present before adding download links
to the UniCORE portal.

The packaged API endpoint in `config/production.json` is
`https://api.unicores.tech/api/v1`. Its HTTPS auth endpoint is reachable, but a
real student login, ticket redemption, exam session, and submission have not
been exercised in this environment. Signing, installation, and protocol
registration must be tested on each target Ubuntu desktop before publication.

During an authorized active attempt, ExamGuard enters Electron kiosk and
fullscreen mode when the exam requires fullscreen, disables normal minimize
and maximize controls, reasserts fullscreen on focus/window/display changes,
blocks configured context-menu and clipboard actions, and intercepts close
requests with a warning. These controls restore when the attempt is submitted
or otherwise ends through the existing authorized flow.

### Platform behavior and recovery

- **Ubuntu/Linux:** Electron kiosk and fullscreen flags request a fullscreen
  window; GNOME Shell normally hides its top panel for fullscreen windows.
  Window-manager extensions, overview gestures, shortcuts, virtual terminals,
  and desktop configuration can still expose system UI. Actual GNOME panel and
  display-change behavior must be tested on the institution's supported
  Ubuntu/GNOME image; it was not verified against a dedicated managed exam
  desktop here.
- **Windows and macOS:** This Linux-only build does not produce or verify
  installers for these platforms. Electron's fullscreen/kiosk behavior must
  be tested on each OS before support is claimed.
- No app window setting can block every operating-system shortcut, virtual
  desktop, force-quit path, or accessibility control. Stronger lockdown
  requires institution-managed kiosk configuration such as Assigned Access or
  Shell Launcher on Windows, Single App Mode/MDM restrictions on macOS, and a
  managed kiosk session/window manager on Linux.
- **Student recovery:** If a launch or session fails, return to the student
  portal, check the exam's server status, and use its launch button to request
  a fresh one-time ticket. Do not reuse a ticket reported as expired or used.
- **Administrator recovery:** Use the institution's approved device-management
  procedure to regain desktop access. Before asking a student to relaunch,
  check the server-side attempt and answer-save status; do not clear the
  student's local profile or attempt to alter the operating system. UniCORE
  remains authoritative for the attempt and its submission.

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
