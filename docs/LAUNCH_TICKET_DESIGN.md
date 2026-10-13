# ExamGuard Launch Ticket Design

**Status:** Approved and implemented in the scoped files listed below.

## Decision summary

Use a short-lived, one-time ticket issued by the authenticated UniCORE student
website. The portal attempts the `unicore-exam://` protocol handoff and keeps
the ticket visible for manual entry as a fallback. Keep ticket redemption,
cookie handling, and authenticated API calls in Electron's main process.
The backend sets its HttpOnly session cookies and signs ExamGuard-specific
access and refresh tokens; JWTs are never returned in JSON or exposed through
preload.

This launch path is only for exams whose `security.sebRequired` is false.
ExamGuard is not Safe Exam Browser and cannot satisfy the existing
`X-SafeExamBrowser-ConfigKeyHash` policy. A ticket must never be used to
authorize a SEB-required exam.

Class-roster membership is not an exam-access requirement. The backend still
requires an authenticated active student, a valid exam and active class, an
enterable status and time window, and a valid attempt. Deadlines, answer
ownership, autosave, and submission remain server-authoritative.

## Legacy behavior and unsafe paths observed before implementation

- `POST /exams/student/validate-token` checks the exam status/window, SEB,
  and an existing submission, but had an explicit comment that class
  enrollment was removed. The human-typed exam token acted as the audience
  policy.
- `GET /exams/student/:examId/start` repeats the status/window and SEB
  checks, but also omitted enrollment. Its stale-submission recovery could
  reset an empty `submitted` submission while the deadline remained open;
  there is no explicit `maxAttempts` field, and the unique
  `(examId, studentId)` submission is the effective one-attempt constraint.
- `POST /exams/student/:examId/autosave` and `/submit` scope the submission
  query to `req.user._id`, but did not reject writes after `sessionEndsAt`.
  A late submit could therefore send new answers after the advertised
  deadline.
- `POST /exams/student/:examId/launch-token` is SEB-specific, stores the
  ticket value directly, and accepts only exams with `sebRequired`.
- `/useb/create-launch-token` stores a hash, but `/useb/launch` accepts
  either the raw value or hash, checks/creates a submission before marking
  the ticket used, does not revalidate the exam window/status or SEB policy,
  and returns a newly generated access JWT in JSON. Do not reuse this
  exchange for ExamGuard.
- Before implementation, `controller/ExamLaunchController.js` was not
  mounted and contained a separate raw-ticket flow that minted access/
  refresh JWTs without saving the refresh-token record, then redirected with
  the exam's reusable human token in the URL. It has been replaced with the
  dedicated ticket issue/redeem handlers.
- `assertSebIfRequired` verifies a request against a per-exam SEB config key.
  An Electron user agent or renderer UI is not equivalent proof.

## HTTP contract (implemented)

All paths use the existing `/api/v1` API prefix. The app-origin and cookie
configuration remain deployment-owned; no URL or server secret is supplied
by the renderer.

### 1. Issue

`POST /exams/student/:examId/launch-ticket` — authenticated by the existing
UniCORE web session and `protect`.

- The path identifies the exam. The server derives the student only from
  `req.user`; no submitted student ID is accepted.
- Require `role === "student"`, active account status, an enterable exam
  status and open availability window (not class-roster membership),
  `sebRequired !== true`, and no terminal submission for this student/exam.
- Generate 32 random bytes and encode as unpadded base64url (43 characters).
- Return the plaintext ticket once with its expiry; persist only
  `SHA-256(ticket)`, `studentId`, `examId`, audience `examguard`, action
  `redeem-and-start`, expiry, and unused/redeemed state.
- Set a 60-second expiry. Apply IP and authenticated-user rate limits.
- Do not log the ticket or save it in web storage. The portal tries the
  registered `unicore-exam://launch?ticket=...` handoff and also displays it
  temporarily for copy/paste. The ticket is short-lived and single-use because
  operating systems may expose protocol arguments to the launched app.
- Clear the website ticket at expiry or when the student cancels; the desktop
  app clears its ticket input after redemption.

### 2. Redeem

`POST /exams/student/launch-ticket/redeem` — unauthenticated ticket exchange,
available only to the fixed ExamGuard main-process operation.

Request:

```json
{ "ticket": "<43-character-base64url-ticket>" }
```

The server hashes the submitted ticket and atomically claims a record only
when its hash, audience, action, unused state, and future expiry all match.
Exactly one concurrent request may claim it. The record binds the resulting
session to its stored student and exam; request-body identity fields are
ignored/rejected.

After claim, re-fetch and verify the stored user and exam: active student
account, active class, enterable status, current exam window,
`sebRequired === false`, and no terminal/extra submission. Do not reset a
previously submitted attempt. Create the existing UniCORE refresh-token
record using the normal auth service, set the existing `accessToken` and
`refreshToken` HttpOnly cookies, and return only a reduced user profile plus
the bound `examId` and expiry/deadline metadata needed by the UI. Never
serialize either JWT.

Ticket claim is atomic and one-shot. If session issuance or revalidation fails
after claim, burn the ticket and require the student to issue another one;
never reopen a claimed ticket. Record a sanitized audit event without the
ticket or its hash. Apply an IP rate limit, generic invalid/expired/redeemed
errors, and `Cache-Control: no-store`.

ExamGuard's main process uses a dedicated persistent Electron session
partition for the window and fixed `session.fetch()` operations. Its preload
exposes only typed operations such as `redeemLaunchTicket`, `getCurrentUser`,
`startExam`, `logout`, and any later approved exam operations. The main
process pins paths to the configured API base, rejects redirects, validates
the sender/main frame and payload sizes, and returns only sanitized profile
and exam data. Renderer code never receives JWTs or cookie values and has no
generic IPC/request facility.

The desktop renderer receives the one-use ticket in an input field, forwards
it over the fixed preload method, then clears the field. It stores no ticket
or credential in local/session storage or logs. The portal protocol handoff
necessarily carries the short-lived ticket in the protocol URL; it must never
contain a reusable exam token or an authentication JWT.

## Eligibility, attempts, and Safe Exam Browser

Exam access eligibility does not require resolving class-roster membership:

1. Require an active account with `role: "student"`.
2. Require the exam and its class to remain active and the exam to be
   enterable and within its availability window.
3. Recheck these facts, plus session ownership and submission state, at ticket
   issue, ticket redemption, and exam start.

The shared `examEligibility.service.js` helper enforces the non-roster
eligibility rules. Do not trust a client-supplied student ID.

The existing unique submission index permits one attempt per student/exam.
There is no separate attempt-limit field. An in-progress submission may be
resumed; terminal submissions remain terminal. Remove/disable stale-submitted
reopening as part of the ExamGuard path so ticket reissue cannot create a
second attempt.

Recheck exam status/window and SEB policy on redemption and start. If
`sebRequired` is true at any point, fail with a clear unsupported-policy
response and leave the normal SEB flow unchanged. Do not simulate or spoof
SEB headers and do not reinterpret an ExamGuard request as SEB.

## Deadlines and submission ownership

Keep normal authenticated route protection and continue deriving
`studentId` solely from `req.user._id`. Autosave and submit continue locating
the attempt by both `examId` and `studentId`; never accept a student or
submission owner from the payload.

For an `in-progress` submission, accept autosave and submit only before
`sessionEndsAt`. Perform the status/deadline condition and write atomically
against the submission document so a concurrent late request cannot overwrite
a terminal submission or save after expiry. On the first request at/after the
deadline, atomically finalize the last server-saved answers with existing
grading logic; ignore any answers supplied by that late request and respond
with an explicit expired outcome. This expiry behavior was approved during
design review. The existing schema has no separate `expired` status, so
preserve existing grading/status semantics. Never trust the renderer timer as
enforcement. This is lazy finalization on a request, not a background
scheduler; an idle attempt is finalized when next accessed.

## Session and logout semantics

- The website's existing login (including Turnstile) remains the only
  credential login; this flow does not bypass it.
- Redemption creates an ordinary UniCORE desktop session in the isolated
  Electron cookie jar, with existing access/refresh lifetimes and refresh
  rotation. The main process discards access-token JSON fields on refresh.
- Logout attempts `/auth/logout`, then clears only ExamGuard's UniCORE
  cookies. If the API is unavailable, report that server-side refresh-token
  revocation could not be confirmed.
- The refresh-token record remains subject to existing server revocation and
  expiry. The website session is not copied into the desktop partition.
- Production must supply the approved HTTPS API base and confirm actual
  deployed `Set-Cookie` attributes (`HttpOnly`, `Secure`, `SameSite`,
  `Domain`, `Path`) before release. Do not infer production settings from
  source defaults.

## Implemented change scope

### Backend

- `routes/examRoutes.js` — add issue/redeem routes before parameterized student
  routes; keep the existing SEB and `/useb` routes separate.
- `controller/ExamLaunchController.js` — replace the unmounted unsafe
  duplicate with the dedicated issue/redeem handlers, or remove it if the
  handlers are placed in the existing `ExamController.js`.
- `model/ExamLaunchToken.js` — add explicit audience/action and hashed-ticket
  storage for new ExamGuard tickets while preserving legacy record semantics;
  add suitable expiry/indexing.
- `controller/ExamController.js` — share eligibility checks with token
  validation/start, enforce no SEB bypass, prevent stale attempt reopening,
  and enforce atomic deadline/ownership behavior for autosave/submit.
- `services/auth.service.js` and `controller/authController.js` only if
  necessary to issue the standard cookie session through the existing refresh
  token persistence path without exposing JWTs.
- `middleware/rateLimiter.js` — add bounded issue/redeem limits if no existing
  limiter fits; never disable the current login/Turnstile limiter.
- `services/examEligibility.service.js`, `services/examDeadline.service.js`,
  `tests/examGuardLaunch.test.js`, `tests/examEligibility.test.js`, and
  `tests/examDeadline.test.js` — shared authorization/deadline logic and
  mock-based ticket, eligibility, single-use, and expiry tests.

### UniCORE frontend

- `src/student/pages/StudentExamPortal.jsx` — add a one-time ExamGuard ticket
  issue/display/copy path only for non-SEB exams; retain the existing SEB
  launch UX and normal browser start.
- `src/student/pages/StudentExamPortal.test.jsx` (new) — verify authenticated
  issue call, SEB exclusion, temporary ticket display, copy/error/expiry
  behavior, and no URL/storage persistence.

### ExamGuard

- `src/main/index.js` and `src/main/security.js` — dedicated session
  partition, fixed API requests, origin/redirect/sender validation.
- `src/main/launchTicket.js` and `src/main/launchTicketIpc.js` — fixed
  authenticated API adapter and narrow IPC handlers.
- `src/preload/index.js` — typed ticket/session methods only.
- `src/renderer/src/App.jsx` and `src/renderer/src/styles.css` — minimal
  ticket entry, loading/error/authenticated/expired/logout states using only
  `#2C2DE0` and `#FFFFFF`.
- `src/main/launchTicket.test.js` and `src/main/launchTicketIpc.test.js`
  (new) — fixed operations, rejected arbitrary requests, malformed responses,
  token non-disclosure, session refresh/logout, and network failures.
- `config/production.json` — deployment owner must provide the approved
  HTTPS API base before a packaged production app can authenticate. Do not
  fill it with an unconfirmed origin.

No new exam/student database or model is proposed. `ExamLaunchToken` is the
existing launch-ticket collection and `Submission` remains the only attempt
store. No unrelated web features or Safe Exam Browser implementation are in
scope.

## Required tests

1. Invalid format/value, expired, already-redeemed, wrong audience/action,
   wrong exam binding, and wrong stored student binding are rejected.
2. A caller-supplied `studentId` cannot change the student bound to the ticket
   or resulting auth cookies.
3. Two concurrent redemption requests produce exactly one successful claim.
4. Redemption and start allow an otherwise eligible student absent from the
   roster, while still rejecting inactive/non-student accounts, inactive
   classes, unavailable/paused exams, and unsupported SEB-required exams.
5. A ticket cannot start a terminal or second attempt; an in-progress attempt
   resumes only for its owner.
6. Autosave/submit do not accept late client answers; first post-deadline
   access finalizes only persisted answers and cannot write another student's
   submission.
7. Main/preload tests prove only fixed methods are exposed and no token,
   cookie, password, or arbitrary URL/header reaches renderer state/logs.
8. Malformed backend responses and network/refresh/logout failures are
   explicit; failed logout does not claim server revocation.

## Review gates and unresolved deployment requirements

Before a production release, provide the production API base and confirm
deployed cookie domain/SameSite/Secure behavior and that Electron
main-process requests carry no disallowed `Origin`. Verify production
MongoDB has the required unique/expiry indexes. Until these deployment checks
pass, do not advertise packaged authentication as live. No running-API
integration, production cookie, SEB, or real-account behavior has been
verified.

## Source inspected

- Backend: `routes/examRoutes.js`, `routes/usebRoutes.js`,
  `controller/ExamController.js`, `controller/usebController.js`,
  `controller/ExamLaunchController.js`, `controller/authController.js`,
  `services/auth.service.js`, `services/token.service.js`,
  `model/Exam.js`, `model/ExamLaunchToken.js`, `model/Submission.js`,
  `model/User.js`, `model/UniversityStudent.js`, `model/class.js`,
  `middleware/AuthMiddleware.js`, `middleware/rateLimiter.js`,
  `utils/cookies.js`, `utils/sebCheck.js`, and
  `tests/examSession.test.js`.
- Frontend: `src/student/pages/StudentExamPortal.jsx`,
  `src/student/pages/StudentExamSession.jsx`, `src/api/client.js`,
  `src/context/AuthContext.jsx`, and `src/api/baseUrl.js`.
- ExamGuard: `docs/AUTHENTICATION_DESIGN.md`, `docs/ARCHITECTURE.md`,
  `docs/PROJECT_PLAN.md`, `src/main/index.js`, `src/main/security.js`,
  `src/preload/index.js`, and `src/renderer/src/App.jsx`.

## Implementation record

- The authenticated UniCORE portal issues a one-time ticket for non-SEB exams
  and temporarily renders/copies it without putting it in a URL or web
  storage. The screen removes it at expiry.
- Ticket records are SHA-256 hashed, purpose/audience/action scoped, expire
  after 60 seconds, and are atomically claimed with a conditional
  `findOneAndUpdate`. A TTL index removes expired rows eventually; correctness
  does not depend on TTL cleanup.
- Redemption revalidates the stored student, class status, exam status,
  window, SEB policy, and existing attempt before using the existing auth
  service to create the regular persisted refresh-token record and setting
  standard HttpOnly cookies. JWT values are omitted from the response.
- ExamGuard uses a dedicated persistent Electron session and fixed preload
  operations. Signed JWT claims distinguish its protected exam-session
  requests from ordinary website requests; refresh rotation preserves the
  claim. The renderer takes the exam only in the authorized desktop workspace.
- Exam validation/start do not require class-roster membership. Start no
  longer reopens stale submitted attempts. Autosave and submit use atomic
  status/deadline guards; the first post-deadline request finalizes only
  server-saved answers and rejects client-supplied late answers.
- Existing SEB and `/useb` paths remain separate and are not used by
  ExamGuard. The `/useb` issuer labels its records separately so the new
  redemption endpoint cannot consume those legacy credentials.

Automated tests cover ticket hashing, binding, atomic-claim query shape,
concurrent redemption, eligibility/SEB failures, expired-attempt
finalization, fixed Electron IPC operations, token non-disclosure, refresh,
logout cookie cleanup, network/malformed responses, and the web handoff UI.
These use mocks; production MongoDB atomic behavior, deployed cookies, and a
running API have not been integration-tested.

The microphone monitor requests access only when required, reports device
status, and does not record or transmit audio. Camera snapshots are only
captured when camera monitoring is required. Fullscreen/kiosk restrictions
are application-level and do not provide OS-level lockdown; ExamGuard must
not be used for exams requiring Safe Exam Browser or managed browser lock.

Remaining release requirements: verify the deployed HTTPS API URL, cookie
scope and Electron `session.fetch()` behavior, and production MongoDB indexes.
No live production-account/API integration was performed by the latest
workspace checks, so deployment must still be verified independently.
