# ExamGuard Authentication Discovery and Design

**Status:** Discovery baseline; desktop authentication is implemented through
the approved launch-ticket flow documented in
[`LAUNCH_TICKET_DESIGN.md`](./LAUNCH_TICKET_DESIGN.md).

## Current authorization boundary

The signed-in portal may validate an exam token and request a one-use
ExamGuard launch ticket, but it cannot load exam questions or create, resume,
save, or submit an attempt in a normal browser session. The
`/exam-session/:examId` route now directs students back to the portal.

Ticket redemption creates an active-student ExamGuard session and issues
signed access/refresh JWTs with the `clientType: "examguard"` claim while
setting the normal HttpOnly cookies. The claim is signed by the backend and
preserved during refresh rotation; it is not accepted from a request header.
Backend start, recovery, answer, code execution, proctoring, fault, and
submission endpoints require this claim. Class-roster membership is not
required, but the backend still checks identity, account status, exam/class
status, availability, ticket/session ownership, deadlines, and submission
rules.

Microphone-required exams are supported through status-only monitoring; ExamGuard
does not record or transmit audio. Camera snapshots are only used when camera
monitoring is required. Fullscreen and kiosk presentation are app-level
restrictions, not OS-level lockdown.

## Recommendation

Use UniCORE's existing web login (including its mandatory Turnstile check) to
authenticate the student, then pass a short-lived one-time launch ticket into
a **dedicated Electron session and fixed main-process API operations**:

1. Give ExamGuard a dedicated persistent Electron session partition, for
   example `persist:examguard-auth`.
2. The student requests a 60-second launch ticket from the signed-in UniCORE
   student portal. The portal tries the `unicore-exam://` handoff and leaves
   the ticket available for manual entry if the app is not installed. The
   short-lived ticket may appear in OS protocol arguments, but must never be
   logged or persisted by the portal.
3. Redeem the ticket from Electron's main process using its session's
   `session.fetch()` and fixed API paths. Let the backend set its existing
   `HttpOnly`, `Secure` cookies in the Electron session cookie store.
4. Return only a reduced user profile and operation status to the renderer.
   Discard the `accessToken` field in refresh response JSON in the main
   process. Never return either token from the preload bridge.
5. Expose only typed ticket/session methods such as `redeemLaunchTicket`,
   `getCurrentUser`, `startExam`, and `logout`; do not expose a generic HTTP
   request, IPC, URL, or header API.

Electron documents that [`session.fetch()`](https://www.electronjs.org/docs/latest/api/session#sesfetchinput-init)
uses that session's network stack. Keeping the window and fixed main-process
requests on the same partition provides a cookie jar separate from the
system-browser session and other Electron partitions. The `HttpOnly` refresh
cookie remains inaccessible to renderer JavaScript.

This design reuses UniCORE's current web login and cookie contracts without
embedding Turnstile on a `file://` renderer or adding a JWT-bearing OAuth
callback. Ticket contract and implementation details are in
[`LAUNCH_TICKET_DESIGN.md`](./LAUNCH_TICKET_DESIGN.md).

## Authentication flow comparison

### Option 1 — isolated Electron cookie session after ticket redemption (selected)

**Existing support:** refresh, logout, and `/auth/me` already set or consume
authentication cookies. `protect` accepts the access-token cookie. Ticket
redemption creates a normal server-side refresh-token record and sets these
existing cookies in the dedicated Electron session.
The cookie utility marks cookies `HttpOnly`, sets `Path=/`, derives `Secure`
and `SameSite` from the request/deployment, and configures an optional domain.
The configured production deployment is intended to use secure cookies.

**Important boundary:** a packaged renderer loads from local files. Its
`file://` origin is not in the backend CORS allowlist; the current server
origin middleware will reject a non-empty disallowed origin. Do not allow the
opaque `null` origin as a workaround. Route the fixed auth operations through
Electron's main process and the dedicated Electron session. Main-process
requests do not rely on renderer CORS. The server currently accepts requests
without an `Origin` header, but confirm that `session.fetch()` sends no
disallowed origin in the actual Electron build. `protect` still requires valid
authentication. CORS must not be treated as authentication or authorization.

**Tradeoffs:**

- The main process must validate operation inputs, pin requests to the
  configured HTTPS API origin, prevent redirects to other origins, and avoid
  logging credentials or response tokens.
- Passwords and Turnstile tokens remain on the UniCORE web login; ExamGuard
  receives only a short-lived, single-use ticket through manual copy/paste.
  A compromised ExamGuard renderer could still capture that ticket before
  redemption, so its short lifetime and atomic single-use semantics matter.
- Electron session cookies are not shared with Chrome, Firefox, or the user's
  system browser. Cookie storage is managed by Chromium/Electron and is not a
  defense against compromise of the local OS account.
- Renderer calls cannot directly use the session cookie with the current CORS
  policy. Future authenticated operations must use fixed main-process
  operations too, unless a separately approved stable app origin and CORS
  policy are implemented.

### Option 2 — new system-browser OAuth callback handoff (not selected)

**Existing support:** the web app has Passport Google redirect endpoints at
`GET /auth/google` and `GET /auth/google/callback`. The callback issues the
normal auth cookies and redirects to the UniCORE frontend's
`/oauth-callback`; that page calls `/auth/me`. The callback is designed for the
web frontend, not an ExamGuard app protocol.

**Missing capability:** there is no ExamGuard callback URI, desktop-bound
one-time authorization code, or code-consumption route in that OAuth flow.
System-browser cookies do not automatically enter an isolated Electron
session. Reusing a web session cookie, putting a JWT in a deep-link URL, or
passing a token in a command-line argument would cross the trust boundary
insecurely. The selected approach is instead a short-lived ticket copied from
the authenticated UniCORE student portal.

**Conclusion:** the current Google OAuth redirect does not authenticate the
desktop app. Use the approved ticket flow; do not claim the redirect itself
provides desktop authentication.

## Existing UniCORE authentication contract

The backend mounts auth routes under both `/api/v1` and `/api`. New client
configuration should use a base ending in `/api/v1`.

### Login

`POST /auth/login` — rate-limited and protected by `verifyTurnstile`.

Request schema from `loginSchema`:

```json
{
  "email": "student@example.edu",
  "password": "user-entered password",
  "deviceId": "optional client-generated device identifier",
  "turnstileToken": "required server-verified challenge token"
}
```

Only `email` and `password` are required by the Zod request schema;
`deviceId` and `turnstileToken` are optional in that schema. However,
`verifyTurnstile` independently rejects a missing server secret with `503`
and a missing/invalid challenge token with `400`. The existing UniCORE web
login must provide the challenge token and must not skip verification or send
a client-asserted `verified` flag. ExamGuard does not call this endpoint or
bundle the server-side Turnstile secret.

Successful response:

```json
{
  "success": true,
  "message": "Login successful.",
  "data": {
    "user": {},
    "accessToken": "returned in JSON by the current API"
  }
}
```

The API also sets `accessToken` and `refreshToken` cookies. The refresh token
is not returned in the JSON body. A desktop main-process adapter must discard
the JSON `accessToken`, store no token in renderer state, and return only the
user projection needed by the UI. Invalid credentials return `401`; an
unverified/inactive account may return `403`; verification infrastructure
errors include `400`/`503`.

### Refresh

`POST /auth/refresh-token` (canonical client path; `/auth/refresh` is an
existing alias). The refresh token is read from the `refreshToken` cookie.
`deviceId` may be supplied in the JSON body; no refresh token is accepted in a
request body.

```json
{ "deviceId": "optional client-generated device identifier" }
```

On success the backend rotates the refresh token, sets new access/refresh
cookies, and returns:

```json
{
  "success": true,
  "message": "Token refreshed successfully.",
  "data": { "accessToken": "returned in JSON by the current API" }
}
```

Refresh JWTs expire after 30 days, are stored server-side by token hash, and
are rotated. The service has a 30-second grace path for concurrent reuse of a
recently rotated token; outside that window reuse can revoke its token family.
The browser client coordinates refresh requests into one operation and retries
an eligible request once. The desktop main process should implement the same
single-flight and one-retry behavior; do not return the access token to React.
Missing, expired, or invalid refresh cookies return `401` and the controller
clears auth cookies.

### Logout

`POST /auth/logout` is protected by `protect`. It reads the refresh cookie,
deletes the matching hashed refresh-token record if present, clears both
cookies with their configured scope, and returns:

```json
{
  "success": true,
  "message": "Logged out successfully.",
  "data": null
}
```

The access JWT is stateless and is not individually revoked by this handler;
it can remain cryptographically valid until its 15-minute expiry. Clear the
Electron session's UniCORE cookies at logout even if the request fails, and
report that server-side revocation could not be confirmed when offline. Do
not claim a successful server logout if no successful response was received.

### Current user

`GET /auth/me` is protected. It accepts the access-token cookie and returns:

```json
{
  "success": true,
  "message": "User profile fetched successfully.",
  "data": {
    "id": "user id",
    "name": "name",
    "email": "email",
    "fullName": "display name",
    "role": "student",
    "permissions": [],
    "provider": "local or google",
    "status": "active",
    "isVerified": true,
    "isUniversityVerified": false
  }
}
```

The backend's user projection also includes profile, department, skills,
language, university ID, gender, last-login, and creation fields when present.
ExamGuard should return/render only necessary user fields, not persist this
profile as an authentication credential. A `401` means the access cookie is
missing/expired; attempt one coordinated refresh, then call `/auth/me` once
more.

## Token and cookie handling observed

- Backend `protect` prefers a Bearer token if supplied; otherwise it reads the
  `accessToken` cookie. ExamGuard should use the cookie path and must not
  duplicate the browser client's Bearer-token handling.
- Access JWT lifetime is 15 minutes. Refresh JWT lifetime is 30 days.
- Both cookie names are `accessToken` and `refreshToken`; cookies are
  `HttpOnly`, `Path=/`, and receive `Secure`/`SameSite` options from
  `utils/cookies.js`.
- For production/non-local requests, the source defaults to `Secure` when
  production is detected and to `SameSite=None` when secure unless an explicit
  SameSite option is configured. A domain may be configured or inferred as
  `.unicores.tech` from the server host. Actual production environment values
  and deployed response headers were not inspected, so verify real `Set-Cookie`
  headers in an approved deployment before release.
- Local requests use `SameSite=Lax`; `Secure` depends on whether the API request
  itself is HTTPS. Do not assume localhost cookie behavior models production.
- The web client holds the access token only in module memory, but login and
  refresh responses put that access token in JSON. Its Axios response
  interceptor captures the token and adds Bearer headers; auth state is
  rehydrated with `/auth/me` and the refresh interceptor. The refresh token is
  not stored in localStorage; it stays in the HttpOnly cookie.
- `AuthContext` stores a separate optional guest marker in localStorage. That
  is not the refresh/access token flow; ExamGuard must not treat a guest marker
  as authenticated.
- Login uses the shared Axios client and `withCredentials: true`; logout
  clears the in-memory token/user and posts `/auth/logout`.

## Integration requirements for a future implementation

### API base URL

- Use the Phase 2B non-secret configuration files:
  `config/development.json` and `config/production.json`.
- Development may use loopback HTTP (the current development config points to
  the local backend). Packaged production must use the approved HTTPS API
  origin and `/api/v1` base path.
- The production API endpoint is `https://api.unicores.tech/api/v1`, matching
  the backend `SERVER_URL` host and confirmed by its JSON health and protected
  auth routes. The website host is not the API host. The app config contains
  only this public endpoint; do not copy credentials from environment files.
- Validate the configured origin and pin every auth operation to that base.
  Prevent cross-origin redirects and do not let renderer-supplied URLs or
  headers control main-process requests.

### IPC/API surface

Fixed operations implemented for ticket/session management:

```text
redeemLaunchTicket({ ticket }) -> { user, exam }
getCurrentUser()               -> { user }
startExam()                    -> { session summary }
logout()                       -> { ok, message? }
```

Main-process requirements:

- Each method maps to a hard-coded HTTP method/path. Validate payload types,
  length bounds, and the sender's main-frame URL.
- Use the dedicated `session.fetch()` with `credentials: "include"` and JSON
  content type; do not accept arbitrary URL, method, headers, or request body.
- Never log password, challenge token, cookies, access-token response values,
  or refresh-token values. Sanitize error responses before returning them.
- Discard `data.accessToken` from refresh responses before any IPC return.
- Coalesce concurrent refresh operations. Retry a protected operation once
  after refresh only; do not retry login or logout automatically.
- On startup, call `/auth/me`; on `401`, refresh once and retry `/auth/me`.
- At logout, attempt backend revocation, then clear only the ExamGuard session's
  UniCORE cookies; surface when server revocation could not be confirmed.
- Do not expose an arbitrary `fetch`, `request`, `invoke`, filesystem, shell,
  or `openExternal` function in preload.

### CSP and CORS

- **Selected main-process request design:** the renderer does not call the
  UniCORE API, so do not add a remote UniCORE API origin to renderer
  `connect-src`. Keep API traffic in fixed main-process operations. In the
  packaged renderer, `connect-src` can remain limited to `'self'`. In
  development, allow only the actual local Vite HMR origin/websocket (the
  current renderer is `http://localhost:5173`; the CSP currently names
  `127.0.0.1`, so verify/fix that development-only mismatch before
  implementation).
- **Turnstile:** ExamGuard does not embed the widget. The existing UniCORE web
  login performs the challenge before it can issue a ticket; the packaged
  renderer adds no Turnstile origins or CSP exceptions.
- Current production CORS allows the UniCORE web origins
  `https://www.unicores.tech` and `https://unicores.tech`; development defaults
  to `http://localhost:5173`. The global origin middleware rejects other
  explicit origins. Do not add `null` to CORS. Main-process requests without an
  `Origin` header avoid this browser CORS dependency, but still require normal
  authentication.
- If a future change moves API calls into the renderer, stop and review a
  stable, non-opaque app origin and exact CORS/cookie policy first. Do not
  weaken the origin middleware as a shortcut.

### Logout and session expiry

- Store no token in renderer state or local files; the current access-token
  JSON field is consumed and discarded in the main process.
- The main process uses the access cookie for `/auth/me` and `/auth/logout`;
  refresh is cookie-only and rotates cookies server-side.
- A `401` from `/auth/me` or another protected request causes one single-flight
  refresh attempt and at most one retry. A rejected refresh presents the
  ticket-entry state; a network failure is shown explicitly.
- Logout clears local/session state regardless of network availability. If
  `/auth/logout` cannot be confirmed, explain that the server refresh token
  could remain valid until expiry or revocation; do not represent local cookie
  deletion as server-side revocation.
- Auth cookies are isolated from the normal system browser and from unrelated
  Electron partitions. The selected partition is persistent; logout removes
  only the UniCORE access/refresh cookies from that partition.
- The API base URL remains in the main process; the preload exposes no public
  config or generic network surface.

## Testing plan

### Contract and backend integration tests

- Ticket redemption sets both cookies; verify exact `HttpOnly`, `Secure`,
  `SameSite`, `Path`, and `Domain` attributes on the approved production
  origin. Verify response status/body without logging token values.
- Existing UniCORE web login continues to reject invalid credentials,
  unverified/inactive accounts, missing/invalid Turnstile, and Turnstile
  outages according to its current contract.
- Access/refresh response tokens are never copied into localStorage,
  renderer-visible bridge results, logs, command lines, or persisted config.
- `/auth/me` succeeds with the access cookie and rejects missing/expired
  credentials. Only the intended account profile is returned.
- Refresh rotates both cookies, rejects expired/revoked cookies, exercises
  the service's concurrent refresh grace behavior, and proves only one client
  refresh operation is in flight.
- Logout removes the stored refresh-token record, clears cookies with matching
  scope, and handles expired-access/offline outcomes without false success.
- Confirm request-origin behavior from main-process `session.fetch()` in
  development and production, and confirm no `null` Origin CORS exception is
  introduced.

### Electron and renderer tests

- Renderer security preferences remain `contextIsolation: true`,
  `nodeIntegration: false`, and `sandbox: true`.
- Preload exports only fixed auth methods; attempts to supply arbitrary paths,
  methods, or headers are rejected/not representable.
- IPC rejects a subframe or untrusted navigation sender.
- No popup, redirect, arbitrary navigation, or renderer-controlled external
  URL opens.
- A renderer XSS test cannot read session cookies or access tokens.
- Development API config accepts only loopback HTTP; packaged config accepts
  only approved HTTPS origins.
- Ticket issuance is available only from an already authenticated web
  session; the existing web login's Turnstile verification is unchanged.
- Verify restart behavior for the chosen persistent-session policy and
  confirm logout clears only ExamGuard's session partition.

## Discovery boundaries and unresolved decisions

- This review used local source inspection only. No deployed CORS response,
  production cookie header, student account, or live login was tested.
- Confirm the production API base URL and actual cookie `Domain`,
  `SameSite`, and `Secure` headers with the deployment owner.
- Confirm the production API base URL and deployed cookie attributes before
  release.
- The persistent cookie partition is implemented; local logout clears only
  the UniCORE access and refresh cookies in that ExamGuard partition.
- The backend returns access tokens in JSON even though it also sets cookies.
  The proposed desktop main process must discard them; changing the backend
  response contract is not required for this design.
- Direct desktop login remains unsupported. The approved ticket flow preserves
  the existing web login's Turnstile requirement.

## Initial Phase 3B Turnstile assessment

Direct desktop password login remains unsupported:

- `POST /auth/login` is behind mandatory `verifyTurnstile` middleware. The
  request schema's optional `turnstileToken` does not make the challenge
  optional at runtime.
- The packaged renderer is loaded from `file://`. Cloudflare Turnstile widgets
  are authorized by configured hostnames, and Cloudflare's hostname
  management requires hostnames to be configured. A `file://` page has no
  hostname that can be added to the production widget.
- Serving the packaged UI on `localhost` could provide a hostname, but would
  require changing the renderer's hosting/origin. Cloudflare recommends
  production widgets not allow local hostnames, and the backend's optional
  expected-host check may be configured for the UniCORE website hostname.
  That setting was not inspected because deployment environment values are
  out of scope. Accepting both the desktop and website hostnames may require
  a backend policy change.
- The current ExamGuard config has no public Turnstile site key. A public key
  may be configured without exposing a secret, but it does not resolve the
  hostname or backend expected-host compatibility requirements.

The approved implementation avoids direct desktop password login: the
existing UniCORE web login remains responsible for Turnstile and issues a
one-time ticket only after its authenticated session. The dedicated desktop
session is then established by ticket redemption. Turnstile verification was
not bypassed or changed.

## Source files inspected

- Backend auth routes and validation: [`routes/authRoutes.js`](../../universitybackend-/routes/authRoutes.js), [`Validators/auth.validator.js`](../../universitybackend-/Validators/auth.validator.js)
- Backend login, refresh, logout, and profile handlers: [`controller/authController.js`](../../universitybackend-/controller/authController.js), [`services/auth.service.js`](../../universitybackend-/services/auth.service.js), [`services/token.service.js`](../../universitybackend-/services/token.service.js)
- Backend cookie, CORS, and authentication policies: [`utils/cookies.js`](../../universitybackend-/utils/cookies.js), [`utils/corsConfig.js`](../../universitybackend-/utils/corsConfig.js), [`middleware/AuthMiddleware.js`](../../universitybackend-/middleware/AuthMiddleware.js), [`middleware/turnstile.middleware.js`](../../universitybackend-/middleware/turnstile.middleware.js), [`server.js`](../../universitybackend-/server.js)
- Frontend login, session startup/logout, and API refresh behavior: [`src/auth/Login.jsx`](../../universiyfrontend/src/auth/Login.jsx), [`src/auth/OAuthCallback.jsx`](../../universiyfrontend/src/auth/OAuthCallback.jsx), [`src/context/AuthContext.jsx`](../../universiyfrontend/src/context/AuthContext.jsx), [`src/api/client.js`](../../universiyfrontend/src/api/client.js), [`src/api/baseUrl.js`](../../universiyfrontend/src/api/baseUrl.js), [`vite.config.js`](../../universiyfrontend/vite.config.js)
- Current desktop config and bridge: [`src/main/index.js`](../src/main/index.js), [`src/preload/index.js`](../src/preload/index.js), [`src/renderer/index.html`](../src/renderer/index.html), [`config/development.json`](../config/development.json), [`config/production.json`](../config/production.json)
