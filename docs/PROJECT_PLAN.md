# ExamGuard Project Plan

## Phase 1 discovery result

ExamGuard can be added without replacing the UniCORE web application or
creating another exam database. The workspace currently contains two
independent Git repositories:

- `universiyfrontend/`: React/Vite application, including teacher exam authoring
  and the current browser-based student exam flow.
- `universitybackend-/`: Express API and MongoDB/Mongoose exam system.
- `examguard/`: existing branded logo/icon assets under `images/`; it is not
  currently a Git repository and has no app package manifest or Electron
  source. The three files in `docs/` were added during this discovery phase.

There is no parent Git repository or shared package workspace. The frontend
contains a `pnpm-workspace.yaml`, but it does not declare app packages; its
package manifest has no `workspaces` field. The backend and frontend each have
their own package manifest and lockfile.

## Existing stack and commands

| Area | Current implementation |
| --- | --- |
| Web frontend | React 19, Vite 8, Tailwind CSS 4 |
| API | Node.js ES modules, Express 5 |
| Exam database | MongoDB via Mongoose |
| Authentication | UniCORE JWT access/refresh tokens; protected routes accept a Bearer access token or the `accessToken` cookie |
| Frontend dev server | From `universiyfrontend/`: `npm run dev` (Vite on port 5173) |
| Frontend checks | `npm test`, `npm run lint`, `npm run build` |
| Backend dev server | From `universitybackend-/`: `npm run server` (nodemon) |
| Backend start/tests | `npm start`, `npm test` |

Vite proxies `/api`, `/uploads`, and `/socket.io` to the configured development
backend target (default `http://localhost:8080`). The API router is mounted at
both `/api/v1` and `/api`. Avoid reading local environment files to discover
their values; desktop configuration should receive an explicit API base URL
at build/runtime and must not bundle secrets.

## Existing exam workflow

1. A teacher signs in through the existing UniCORE authentication system.
   Exam routes use `protectTeacher`, which resolves the authenticated user's
   corresponding Teacher record.
2. `TeacherExamsPage` loads classes and exams, builds exam questions/security
   settings, and submits a draft. The backend verifies that the selected class
   belongs to that teacher.
3. `createExam` generates an `EXM-XXXX-XXXX-XXXX` token (12 uppercase hex
   digits, grouped for display) using cryptographic randomness, creates a
   draft, and returns the exam. Publishing is a separate teacher action.
4. A student signs in, enters the access token in `StudentExamPortal`, and
   calls the protected validate-token endpoint. The student then starts or
   resumes the submission by exam ID.
5. The backend creates a unique Submission per `(examId, studentId)` and
   computes the per-student deadline as the earlier of the exam hard close and
   `startedAt + timeLimit`.
6. The student exam client keeps a local draft, debounces server autosave,
   reports integrity events, and submits answers. The server grades supported
   objective question types and sends other types for teacher review.
7. Teachers inspect submissions, grade/publish results, and students can read
   only their own results after they become visible.

The backend start response deliberately projects student-safe question data
and does not include the correct answer. Teacher-only routes return teacher
exam and submission data.

## Phase 2 recommendation

Build ExamGuard as a **standalone Electron application under the existing
`examguard/` directory**, with its own package manifest and lockfile. Keep
teacher exam authoring, the exam database, grading, and student results in the
existing UniCORE systems. ExamGuard should be a student-facing launch/runtime
client that calls the existing API.

Suggested first delivery:

1. Create a minimal Electron main process, narrow preload bridge, React/Vite
   renderer, Tailwind styling, and local development/build/test scripts.
2. Add a typed API adapter for only the needed existing operations:
   authenticated identity, token validation, session start/resume, autosave,
   submit, integrity/fault reporting, and optional published results.
3. Start with ordinary published exams that do not require Safe Exam Browser.
   Before supporting exams with `sebRequired`, agree and implement a
   server-verifiable ExamGuard launch policy; do not pretend client-side
   Electron controls satisfy the existing Safe Exam Browser check.
4. Reuse existing API response contracts and Submission/Exam records. Do not
   add an ExamGuard database, exam model, question store, or duplicate authoring
   flow.
5. Add integration tests for the API contract and security cases before
   shipping a packaged app.

Do not copy authentication tokens into `localStorage`, renderer-accessible
files, command-line arguments, or logs. Use Electron's isolated persistent
session for approved HttpOnly cookies or a deliberately designed one-time
launch exchange. Keep Node privileges out of the renderer.

## Integration gaps and priority

### P0 — resolve before a production ExamGuard rollout

- **Server-side deadline enforcement:** `sessionEndsAt` is returned by
  `startExamSession`, but the inspected `submitExam` and `autosaveExam`
  handlers do not reject a request after that deadline. The desktop timer is
  not an authorization control. Enforce deadlines server-side and define the
  final-save/auto-submit behavior before launch.
- **Exam audience authorization:** token validation and session start contain
  comments that class-enrollment checks were removed; a valid token currently
  grants entry regardless of class membership. Decide whether a shareable code
  is the intended audience policy or restore/replace enrollment checks. Test
  cross-class users explicitly.
- **Token brute-force protection:** the exam controller itself notes that
  validate-token is a brute-force target and should have IP/per-user rate
  limiting. Existing rate limiters cover authentication but not this route.
- **Desktop launch-policy mismatch:** the existing `sebRequired` gate verifies
  Safe Exam Browser request evidence. A plain ExamGuard build cannot satisfy
  that check just by setting a user-agent or adding a client-supplied header.
  Define a distinct, server-verifiable ExamGuard policy or restrict the first
  release to exams that do not require SEB.
- **One-time launch-token flow:** existing `/useb` and
  `/exams/student/:examId/launch-token` paths overlap. The `/useb` exchange
  currently does not re-check exam eligibility or the SEB policy when it
  consumes a token, so it may bypass gates in the normal student-start route.
  Its lookup/check/save sequence also does not atomically consume the token.
  Do not reuse it until policy, authorization, and concurrency handling are
  fixed and tested. Never expose the launch credential beyond the handoff.

### P1 — improve before broad adoption

- The protected student result endpoints already exist and are student-scoped;
  include them only if ExamGuard needs result viewing.
- Existing autosave, integrity/fault reporting, and teacher live-monitor
  endpoints can be reused. Validate their request limits, failure behavior,
  and desktop client retry semantics.
- Existing client-side anti-cheat controls (fullscreen, focus/tab events,
  clipboard prevention, devtools heuristics) are evidence/UX controls, not
  proof that the client cannot be tampered with. Keep grading, timers,
  authorization, and final submission authoritative on the backend.
- Apply request-size limits and validation to answer payloads, code output,
  uploads, camera snapshots, and repeated integrity events.
- Avoid writing student answers or credentials to logs. Encrypt/clear any
  offline answer drafts and bind them to the account and exam; do not treat
  local drafts as proof of submission.

## Phase 2 acceptance checklist

- The packaged app logs in or completes the approved one-time login handoff
  without exposing reusable credentials to page JavaScript or logs.
- A student can validate a token, start/resume only their authorized exam,
  render questions without answer keys, autosave, and submit once.
- A different account cannot read, autosave, submit, or retrieve another
  student's attempt or results.
- API-side timers, attempt uniqueness, exam-open windows, authorization, and
  result visibility remain authoritative if the client clock or local files
  are modified.
- ExamGuard launches only after the backend accepts an expiring, single-use
  credential bound to the authenticated student and intended exam.
- Teacher authoring, grading, and published-result behavior remain unchanged.
- Tests, lint, development startup, packaged build, and platform smoke tests
  pass for each selected desktop OS.

## Assumptions and safeguards

- “ExamGuard” is an additional desktop client, not a replacement for the
  existing browser UI, API, or database.
- The `examguard/` directory is the intended location because it already
  exists and contains branded image assets. It is not currently
  version-controlled; creating a Git repository or moving the folder is
  intentionally left for approval.
- No application code, package manifest, database schema, or API was changed
  during discovery. Only the requested documentation was added.
- No local environment-variable values were opened or included in these
  documents. A credential-looking JSON file is present in the backend folder
  but is ignored and untracked; its contents were not inspected.
