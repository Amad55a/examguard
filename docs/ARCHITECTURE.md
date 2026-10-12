# ExamGuard Architecture

## Current workspace topology

```text
Unicore/                         (no parent Git repository)
├── universiyfrontend/            (independent Git repo; React/Vite web app)
├── universitybackend-/           (independent Git repo; Express/Mongoose API)
└── examguard/                    (unversioned; branded images/ assets)
    ├── docs/                     (Phase 1 discovery documents)
    └── images/                   (existing logo and icon assets)
```

The backend and frontend do not share a package workspace. The web frontend's
`pnpm-workspace.yaml` contains only `allowBuilds` configuration; there are two
independent `package.json` files and lockfiles. The backend persists exams and
attempts in its existing MongoDB database through Mongoose.

## Existing exam components

```text
Teacher React UI
  └── POST /exams (or legacy /exams/teacher) → ExamController.createExam
      ├── verify teacher-owned Class
      ├── generate unique EXM access token
      └── persist Exam and question subdocuments

Student React UI
  ├── POST /exams/student/validate-token
  ├── GET  /exams/student/:examId/start
  │   ├── verify authenticated account, open status/window, SEB policy
  │   ├── create/resume unique Submission
  │   └── return a safe projection of exam questions (no answer key)
  ├── POST /exams/student/:examId/autosave
  ├── POST /exams/student/:examId/submit
  └── POST integrity/fault/proctoring events

Teacher grading UI
  └── /exams/:examId/submissions/* → grading controller
      └── publish results after grading

Student results UI
  └── GET /student/results[/:submissionId]
      └── protected, filtered to req.user and visible results
```

## Recommended ExamGuard application

```text
examguard/
├── docs/
├── images/          # existing branded assets
├── src/
│   ├── main/        # Electron lifecycle and BrowserWindow configuration
│   ├── preload/     # narrow, explicit public-config bridge
│   └── renderer/    # Vite + React + Tailwind CSS 4
│       └── src/
│           ├── api/     # future typed adapter to the existing UniCORE API
│           ├── auth/    # future approved sign-in/session flow
│           └── exam/    # future authorized exam experience
├── electron.vite.config.js
├── package.json
└── lockfile
```

This is the standalone desktop layout created under the existing `examguard/`
directory. The launch-ticket screen connects to the existing UniCORE API;
exam-taking UI remains a later phase. Keep the desktop UI separate to avoid a
risky monorepo conversion and avoid importing from outside the app root.
Reuse the backend contract and visual conventions. If sharing React
components becomes valuable, first create an explicit, tested shared package
in a separately approved workspace change; do not silently copy or move the
whole web exam feature.

## Process and trust boundaries

### Electron main process

- Own window creation, OS-level lifecycle, and the narrowly scoped ticket and
  HttpOnly-cookie handoff.
- Set `contextIsolation: true`, `nodeIntegration: false`, and sandboxing.
- Validate the sender and payload of every IPC call. Expose only the narrow
  operations the renderer needs; never expose `ipcRenderer`, filesystem,
  shell, arbitrary URL opening, or generic command execution.
- Keep secrets, token exchange, and external navigation decisions out of
  renderer JavaScript.

### Preload

- Expose only typed launch-ticket redemption, current-user, start-session, and
  logout methods.
- Keep `ipcRenderer` private to the preload; never expose generic IPC,
  arbitrary network requests, filesystem, shell, API URLs, or URL-opening
  methods.

### React renderer

- Treat the renderer and all locally stored answer state as untrusted.
- Call the existing backend over HTTPS through a small API adapter.
- Use backend time, allowed question projection, server authorization, and
  server submission/grading results as authoritative.
- Keep an offline draft only as recovery UX. Scope it to user + exam, protect
  it appropriately, and clear it on logout/submission/expiry.

### Existing API and data

- MongoDB, `Exam`, `Submission`, `ExamLaunchToken`, `Class`, `Teacher`, and
  `User` remain the source of truth.
- The server currently has two exam launch patterns: the SEB-specific
  `/exams/student/:examId/launch-token` + SEB config routes, and the `/useb`
  launch-token exchange. ExamGuard should not invent a third token collection.
- The `/useb` exchange is a separate legacy flow and must not be used by
  ExamGuard. The ExamGuard flow uses a 60-second hashed, audience/action-bound
  ticket, atomically claims it once, and rechecks student enrollment, exam
  status/window, attempt state, and SEB policy before issuing an ordinary
  UniCORE cookie session. ExamGuard fails closed for SEB-required exams.

## Authentication and origin

The browser API client uses credentials and an in-memory access token; the
backend `protect` middleware accepts a Bearer token or the `accessToken`
cookie. Authentication routes include login, refresh-token, logout, and
current-user lookup. ExamGuard obtains the cookie session through ticket
redemption; it does not perform password login. Teacher exam APIs have a
separate `protectTeacher` middleware that resolves the Teacher record.

The packaged renderer must not assume Vite's `/api` proxy exists. Configure
the backend base URL using `config/development.json` locally and the packaged
`config/production.json` resource for production. The main process validates
the development URL as loopback HTTP and the production URL as HTTPS. Keep the
URL in the main process; preload does not expose it. Fixed main-process
operations preserve the secure refresh flow. Production configuration still
requires deployment confirmation. Do not persist passwords, access tokens,
or refresh tokens in `localStorage`, renderer-readable config, command-line
arguments, or error reports.

The current code has Safe Exam Browser evidence checks for exams with
`security.sebRequired`. A user-agent string or Electron-only UI restrictions
are not an equivalent. Do not weaken the SEB check to make ExamGuard work;
design an explicit server-verifiable policy first.

## Data flow and responsibilities

| Concern | Authority |
| --- | --- |
| Exam creation, token, schedule, question keys | Existing teacher UI + API |
| Student identity and eligibility | Existing authentication + backend policy |
| Attempt identity and uniqueness | MongoDB `Submission` unique index |
| Available questions | Backend start-session projection |
| Countdown display | Renderer display only; server-enforced deadline required |
| Draft/offline recovery | Renderer storage, untrusted and never authoritative |
| Autosave/final answers | Existing protected API, scoped by authenticated student |
| Objective grading/manual review | Existing backend grading services |
| Result visibility | Existing teacher publish workflow + student result API |
| Lockdown/integrity evidence | Client observations plus server-verifiable policy; client-only controls are bypassable |
