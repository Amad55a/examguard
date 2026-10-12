# ExamGuard API Integration

## Base URL and request conventions

The API is mounted at both `/api/v1` and `/api`. Prefer `/api/v1` for a new
client. The web frontend's dev server proxies `/api` to the backend; a packaged
Electron renderer has no Vite proxy and must use a configured absolute HTTPS
base URL.

Existing frontend calls generally use Axios with credentials. Backend
`protect` accepts either a `Bearer` access token or the `accessToken` cookie.
Use the shared security policy and refresh mechanism; do not create a desktop
only bypass for protected endpoints.

Exam responses commonly use:

```json
{
  "status": "success",
  "data": {}
}
```

Some routes include `success: true`, and some return fields such as `results`
outside `data`. The integration adapter should normalize only what the
renderer consumes while preserving backend responses and error status codes.

## Reusable endpoints

| Purpose | Method and path (preferred prefix omitted) | Auth | Notes |
| --- | --- | --- | --- |
| Sign in | `POST /auth/login` | Public, rate-limited | Establishes the existing session/cookie flow; registration/login validation is backend-owned. |
| Refresh session | `POST /auth/refresh-token` | Refresh cookie | Existing refresh rotation path. Do not add a second refresh implementation. |
| Current identity | `GET /auth/me` | Protected | Use to bind local draft state to the current account and confirm session. |
| Validate access code | `POST /exams/student/validate-token` | Protected | JSON body `{ "token": "EXM-..." }`; enforces exam window/status and SEB requirement. |
| Start or resume attempt | `GET /exams/student/:examId/start` | Protected | Creates or returns the unique attempt and server deadline. Returns student-safe question projection and previous server answers. |
| Autosave answers | `POST /exams/student/:examId/autosave` | Protected | JSON body `{ "answers": [...] }`; server scopes Submission by authenticated student. |
| Submit attempt | `POST /exams/student/:examId/submit` | Protected | JSON body `{ "answers": [...] }`; backend grades supported objective types. |
| Report integrity event | `POST /exams/student/:examId/log-cheating` | Protected | Body includes validated `action`; gated by SEB policy when required. |
| Read fault status | `GET /exams/student/:examId/fault-status` | Protected | Returns current attempt's fault summary. |
| Record fault | `POST /exams/student/:examId/record-fault` | Protected | Body can include reason/current question; threshold can auto-submit. |
| Camera heartbeat | `POST /exams/student/:examId/proctor-heartbeat` | Protected | Accepts camera state and a bounded snapshot field. Review privacy and upload policy before desktop use. |
| Student results | `GET /student/results` | Protected | Only visible published results belonging to the current user. |
| Student result detail | `GET /student/results/:submissionId` | Protected | Verifies ownership and visibility; includes student-safe grading feedback. |
| Create ExamGuard/USEB launch token | `POST /useb/create-launch-token` | Protected | Body `{ "examId": "..." }`; returns a short-lived launch credential. Current authorization checks need strengthening before reuse. |
| Consume ExamGuard/USEB launch | `POST /useb/launch` | Public bearer credential | Body `{ "token": "..." }`; one-time, expiring exchange which creates/resumes a submission and returns session information. Treat the token as a password. |

### Teacher-only endpoints (retain in web app)

| Purpose | Method and path | Auth |
| --- | --- | --- |
| Create draft | `POST /exams` | `protectTeacher` |
| List own exams | `GET /exams` | `protectTeacher` |
| Publish | `POST /exams/:examId/publish` (legacy frontend uses `PUT`) | `protectTeacher` |
| List submissions | `GET /exams/:examId/submissions` | `protectTeacher` |
| Grading summary/results | `GET /exams/:examId/submissions/summary` or `/results` | `protectTeacher` |
| Grade/publish a submission | See `/exams/:examId/submissions/:subId/*` in grading router | `protectTeacher` |
| Download SEB config | `GET /exams/:examId/seb-config` | `protectTeacher` |
| Teacher live monitor | `GET /exams/:examId/live-monitor` | `protectTeacher` |

The API is also mounted at `/exams/teacher` for backward compatibility; under
that alias the same route definitions mean teacher collection operations use
paths such as `/exams/teacher`, and a submission path includes both segments.
New ExamGuard code should use the canonical `/exams` student endpoints and
should not call teacher endpoints.

## Existing models and ownership

- **Exam** (`model/Exam.js`): teacher/class ownership, access token, date window,
  time limit, questions, correct answers, security settings, lifecycle status,
  optional SEB config key excluded from normal queries.
- **Submission** (`model/Submission.js`): unique exam/student attempt, answer
  snapshots, timing, grading, result visibility, integrity logs, fault counts,
  and proctoring summary.
- **ExamLaunchToken** (`model/ExamLaunchToken.js`): one-time launch credential,
  exam/student binding, expiry, and consumed timestamp.
- **Class** (`model/class.js`): teacher, students, section and course.
- **Teacher** (`model/Teacher.js`) and **User** (`model/User.js`): separate
  teacher profile and authenticated user identities.

The unique `{ examId, studentId }` Submission index prevents a second ordinary
attempt for the same user/exam. Student autosave, submit, fault, and result
handlers derive `studentId` from `req.user`; the desktop client must never send
an arbitrary student ID as authority.

## Gaps that block a secure desktop integration

1. **Class membership is not enforced for student exam entry.** The validate
   and start controller comments explicitly state that the enrollment check
   was removed and that a valid code is sufficient. Decide policy with the
   exam owner. If access codes are intentionally shareable, add rate limiting
   and audit the intended audience. If they are class-bound, restore a
   server-side membership check before shipping.
2. **Exam-token brute force is not rate-limited.** The validation controller
   calls this out in its own comment; current rate limiters cover login,
   registration, password reset, and verification, not exam token validation.
3. **Attempt deadline is not enforced by the inspected write handlers.**
   `startExamSession` computes `sessionEndsAt`; the current autosave and submit
   handlers check attempt status but do not reject expired `sessionEndsAt`.
   Enforce the deadline and define a server-side finalization policy.
4. **The `/useb` launch exchange bypasses normal entry checks.** Its protected
   token-creation handler checks the exam ID and existence, but not requester
   role, exam availability, class membership, or security mode. Its public
   token-consumption handler checks stored student/exam binding, expiry, and
   prior use, then directly creates/resumes a submission without re-checking
   exam status/window, audience, or `sebRequired`. This can bypass the normal
   student-start SEB gate. It marks the token used after the submission work,
   so concurrent redemptions are not atomically excluded. Fix and test these
   issues before reuse; do not use the flow to evade exam policy.
5. **SEB and ExamGuard are not interchangeable.** Student exam controllers
   enforce `sebRequired` using Safe Exam Browser request evidence. ExamGuard
   needs an explicit server-verifiable policy or must not be allowed to start
   SEB-required exams. Do not simulate SEB headers.
6. **Client integrity controls are not trusted enforcement.** Fullscreen,
   tab/focus, keyboard, and devtools checks run in frontend code and can be
   bypassed by a modified client. Preserve logs as evidence, but secure
   eligibility, timing, answer projection, grading, submission, and results on
   the server.
7. **Answer and upload limits need review.** Validate the maximum number and
   shape of submitted answers against the exam's questions; bound string,
   array, code-output, snapshot, and upload sizes. The server must ignore
   client-supplied scores and answer types.
8. **Two desktop launch implementations overlap.** The `/useb` controller
   and exam controller also contain SEB launch/consume routes using the same
   model. Select and document one flow rather than adding a second
   ExamGuard-specific token model.

## Proposed Phase 2 API adapter surface

Keep renderer components independent from Axios and raw backend response
shapes. Add a small typed adapter with operations such as:

```text
getCurrentUser()
validateExamToken(token)
startOrResumeExam(examId)
autosaveAnswers(examId, answers)
submitExam(examId, answers)
reportIntegrityEvent(examId, action)
getFaultStatus(examId)
recordFault(examId, reason, currentQuestionId)
getPublishedResults()
```

This is an adapter proposal only; it does not imply new backend routes. Use
existing routes first. Return explicit errors to the UI and retry only safe,
idempotent operations. Do not automatically retry final submission until the
API has a reliable idempotency contract.

## Suggested pre-implementation tests

- Unauthenticated calls to validate/start/autosave/submit/results fail.
- A student cannot access another student's submission or results.
- A non-enrolled student cannot enter if class membership is the chosen policy.
- Invalid, expired, reused, and exam-mismatched launch tokens fail.
- Launch credentials are consumed only once, including concurrent redemption.
- No response to a student includes correct answers, SEB secrets, teacher-only
  notes, private AI suggestions, or another student's data.
- Autosave/submit after the server deadline follow the documented rule.
- Repeated submit/retry cannot create or overwrite a second attempt.
- Invalid question IDs/types, oversized payloads, and unknown answer fields
  are rejected or safely ignored.
- API outage, refresh expiry, network loss, and offline-draft recovery display
  explicit states without claiming data was saved.
