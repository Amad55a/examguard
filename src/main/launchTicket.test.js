import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLaunchTicketApi } from './launchTicket.js'

const apiBaseUrl = 'https://api.example.test/api/v1'
const ticket = 'a'.repeat(43)
const user = {
  id: 'user-1',
  name: 'Exam Student',
  fullName: 'Exam Student',
  email: 'student@example.test',
  role: 'student',
  accessToken: 'must-not-be-exposed',
}
const exam = {
  id: '507f1f77bcf86cd799439011',
  title: 'Midterm',
  timeLimit: 45,
  availableUntil: '2030-01-01T00:00:00.000Z',
  sessionEndsAt: null,
}

function response(status, payload, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => payload,
  }
}

function createSession(fetch, cookies = []) {
  const removedCookies = []
  return {
    fetch,
    cookies: {
      get: async () => cookies,
      remove: async (...args) => removedCookies.push(args),
    },
    removedCookies,
  }
}

test('redeems only the fixed ticket operation and returns a reduced profile', async () => {
  const calls = []
  const authSession = createSession(async (url, init) => {
    calls.push({ url: String(url), init })
    return response(200, { success: true, data: { user, exam } })
  })
  const api = createLaunchTicketApi({ apiBaseUrl, authSession })

  const result = await api.redeemLaunchTicket(ticket)

  assert.equal(result.user.id, user.id)
  assert.equal(result.user.accessToken, undefined)
  assert.equal(result.exam.id, exam.id)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${apiBaseUrl}/exams/student/launch-ticket/redeem`)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.credentials, 'include')
  assert.equal(calls[0].init.redirect, 'error')
  assert.deepEqual(JSON.parse(calls[0].init.body), { ticket })
})

test('rejects malformed ticket locally without making an arbitrary request', async () => {
  let called = false
  const api = createLaunchTicketApi({
    apiBaseUrl,
    authSession: createSession(async () => {
      called = true
    }),
  })

  await assert.rejects(api.redeemLaunchTicket('https://evil.example/path'), /valid launch ticket/)
  assert.equal(called, false)
})

test('exposes only fixed ticket/session API operations', async () => {
  const questionId = '507f1f77bcf86cd799439012'
  let savedRequest
  const api = createLaunchTicketApi({
    apiBaseUrl,
    authSession: createSession(async (url, init) => {
      if (String(url).endsWith('/start')) {
        return response(200, {
          status: 'success',
          data: {
            submissionId: 'submission-1',
            answerRevision: 3,
            serverTime: '2026-12-01T00:00:00.000Z',
            answers: [{
              questionId,
              type: 'mcq',
              answer: 'B',
              privateNotes: 'must-not-reach-renderer',
            }],
            exam: {
              _id: exam.id,
              title: exam.title,
              instructions: 'Read each question carefully.',
              endTime: '2026-12-01T00:00:00.000Z',
              security: { sebRequired: true },
              questions: [{
                _id: questionId,
                type: 'mcq',
                question: 'Choose one',
                options: ['A', 'B'],
                image: 'data:image/png;base64,aGVsbG8=',
                environment: 'Python 3',
                allowedLanguages: ['python'],
                starterCode: { python: 'print("hello")' },
                hints: ['Check the input format.'],
                designResources: ['wireframe.png'],
                designColors: ['#102030'],
                designTemplates: ['mobile'],
                sqlSchema: 'CREATE TABLE records (id INTEGER);',
                answer: 'must-not-reach-renderer',
                testCases: [{ expectedOutput: 'hidden' }],
              }],
            },
          },
        })
      }
      if (String(url).endsWith('/autosave')) {
        savedRequest = JSON.parse(init.body)
        return response(200, {
          status: 'success',
          data: { answerRevision: savedRequest.clientRevision },
        })
      }
      if (String(url).endsWith('/submit')) {
        return response(200, {
          status: 'success',
          data: {
            submission: {
              status: 'manual-review',
              submittedAt: '2026-12-01T00:01:00.000Z',
              answers: [{ privateNotes: 'must-not-reach-renderer' }],
            },
          },
        })
      }
      if (String(url).endsWith('/session-status')) {
        return response(200, {
          status: 'success',
          data: {
            examId: exam.id,
            status: 'manual-review',
            sessionEndsAt: '2026-12-01T00:01:00.000Z',
            submittedAt: '2026-12-01T00:01:00.000Z',
            answerRevision: 4,
            serverTime: '2026-12-01T00:01:01.000Z',
          },
        })
      }
      return response(404, { success: false })
    }),
  })

  assert.deepEqual(Object.keys(api).sort(), [
    'autosaveAnswers',
    'getCurrentUser',
    'getExamSessionStatus',
    'logout',
    'recordExamFault',
    'redeemLaunchTicket',
    'reportSecurityViolation',
    'runCode',
    'sendProctorHeartbeat',
    'startExam',
    'submitExam',
  ])
  const session = await api.startExam(exam.id)
  assert.deepEqual(session, {
    submissionId: 'submission-1',
    exam: {
      id: exam.id,
      title: exam.title,
      instructions: 'Read each question carefully.',
      sessionEndsAt: '2026-12-01T00:00:00.000Z',
      timeLimit: null,
      availableUntil: null,
      security: {
        cameraRequired: false,
        microphoneRequired: false,
        fullscreenRequired: true,
        browserLock: false,
        disableCopy: true,
        disablePaste: true,
        disableRightClick: true,
        detectTabSwitch: true,
        autoSubmit: true,
        recordViolations: true,
      },
    },
    questions: [{
      id: questionId,
      type: 'mcq',
      question: 'Choose one',
      marks: null,
      hasImage: true,
      options: ['A', 'B'],
      image: 'data:image/png;base64,aGVsbG8=',
      environment: 'Python 3',
      allowedLanguages: ['python'],
      starterCode: { python: 'print("hello")' },
      hints: ['Check the input format.'],
      designResources: ['wireframe.png'],
      designColors: ['#102030'],
      designTemplates: ['mobile'],
      sqlSchema: 'CREATE TABLE records (id INTEGER);',
    }],
    answers: [{ questionId, type: 'mcq', answer: 'B', codeOutput: '' }],
    answerRevision: 3,
    serverTime: '2026-12-01T00:00:00.000Z',
  })
  assert.equal(JSON.stringify(session).includes('must-not-reach-renderer'), false)
  assert.equal(JSON.stringify(session).includes('expectedOutput'), false)

  await api.autosaveAnswers(exam.id, {
    answers: [{ questionId, type: 'mcq', answer: 'A' }],
    clientRevision: 4,
  })
  assert.deepEqual(savedRequest, {
    answers: [{ questionId, type: 'mcq', answer: 'A', codeOutput: '' }],
    clientRevision: 4,
  })
  assert.deepEqual(await api.submitExam(exam.id, {
    answers: [{ questionId, type: 'mcq', answer: 'A' }],
    clientRevision: 5,
  }), {
    status: 'manual-review',
    submittedAt: '2026-12-01T00:01:00.000Z',
  })
  assert.equal((await api.getExamSessionStatus(exam.id)).status, 'manual-review')
  await assert.rejects(api.startExam('https://evil.example'), /unavailable/)
})

test('current-user refresh is cookie based and retries once without exposing token JSON', async () => {
  const calls = []
  let meAttempts = 0
  const authSession = createSession(async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/auth/me') && meAttempts++ === 0) {
      return response(401, { success: false, message: 'expired' })
    }
    if (String(url).endsWith('/auth/refresh-token')) {
      return response(200, {
        success: true,
        data: { accessToken: 'must-not-be-exposed' },
      })
    }
    return response(200, {
      success: true,
      data: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  })
  const api = createLaunchTicketApi({ apiBaseUrl, authSession })

  const result = await api.getCurrentUser()

  assert.equal(result.user.id, user.id)
  assert.equal(result.user.accessToken, undefined)
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    '/api/v1/auth/me',
    '/api/v1/auth/refresh-token',
    '/api/v1/auth/me',
  ])
  assert.ok(calls.every(({ init }) => init.credentials === 'include'))
})

test('successful logout accepts the existing null data contract', async () => {
  const api = createLaunchTicketApi({
    apiBaseUrl,
    authSession: createSession(async () => response(200, { success: true, data: null })),
  })
  assert.deepEqual(await api.logout(), { ok: true })
})

test('logout reports server failure and removes only UniCORE auth cookies', async () => {
  const authSession = createSession(
    async () => response(503, { success: false }),
    [
      { name: 'accessToken', domain: '.example.test', path: '/', secure: true },
      { name: 'refreshToken', domain: '.example.test', path: '/', secure: true },
      { name: 'preferences', domain: '.example.test', path: '/', secure: true },
    ],
  )
  const api = createLaunchTicketApi({ apiBaseUrl, authSession })

  const result = await api.logout()

  assert.equal(result.ok, false)
  assert.equal(authSession.removedCookies.length, 2)
  assert.deepEqual(
    authSession.removedCookies.map(([, name]) => name).sort(),
    ['accessToken', 'refreshToken'],
  )
})

test('malformed API data and network failures are explicit', async () => {
  const malformedApi = createLaunchTicketApi({
    apiBaseUrl,
    authSession: createSession(async () => response(200, { success: true, data: [] })),
  })
  await assert.rejects(malformedApi.redeemLaunchTicket(ticket), /invalid response/)

  const networkApi = createLaunchTicketApi({
    apiBaseUrl,
    authSession: createSession(async () => {
      throw new Error('network detail')
    }),
  })
  await assert.rejects(networkApi.redeemLaunchTicket(ticket), /could not be reached/)
})

test('runs code only for an allowed coding question and returns a reduced result', async () => {
  const questionId = '507f1f77bcf86cd799439012'
  const calls = []
  const api = createLaunchTicketApi({
    apiBaseUrl,
    authSession: createSession(async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/start')) {
        return response(200, {
          status: 'success',
          data: {
            submissionId: 'submission-1',
            exam: {
              _id: exam.id,
              title: exam.title,
              questions: [{
                _id: questionId,
                type: 'lab',
                question: 'Print a value.',
                allowedLanguages: ['python'],
              }],
            },
          },
        })
      }
      return response(200, {
        status: 'success',
        data: {
          ok: true,
          output: '42',
          exitCode: 0,
          executionTime: 12,
          timedOut: false,
          secret: 'must-not-reach-renderer',
        },
      })
    }),
  })
  await api.startExam(exam.id)
  const result = await api.runCode(exam.id, {
    questionId,
    language: 'python',
    code: 'print(42)',
  })
  assert.deepEqual(result, {
    ok: true,
    output: '42',
    exitCode: 0,
    executionTime: 12,
    timedOut: false,
  })
  assert.equal(calls[1].url, `${apiBaseUrl}/exams/student/${exam.id}/questions/${questionId}/run`)
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    language: 'python',
    code: 'print(42)',
    stdin: '',
  })
  await assert.rejects(api.runCode(exam.id, {
    questionId,
    language: 'javascript',
    code: 'console.log(42)',
  }), /not enabled/)
})

test('posts only validated camera status to the existing proctor heartbeat API', async () => {
  const calls = []
  const api = createLaunchTicketApi({
    apiBaseUrl,
    authSession: createSession(async (url, init) => {
      calls.push({ url: String(url), init })
      return response(200, { status: 'success', data: { recorded: true } })
    }),
  })
  assert.deepEqual(await api.sendProctorHeartbeat(exam.id, {
    cameraOk: true,
    snapshot: 'data:image/jpeg;base64,aGVsbG8=',
  }), { recorded: true })
  assert.equal(calls[0].url, `${apiBaseUrl}/exams/student/${exam.id}/proctor-heartbeat`)
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    cameraOk: true,
    snapshot: 'data:image/jpeg;base64,aGVsbG8=',
  })
  await assert.rejects(api.sendProctorHeartbeat(exam.id, {
    cameraOk: true,
    snapshot: 'data:image/svg+xml;base64,PHN2Zz4=',
  }), /status update was invalid/)
  assert.equal(calls.length, 1)
})

test('uses only existing UniCORE exam security endpoints with fixed event values', async () => {
  const calls = []
  const api = createLaunchTicketApi({
    apiBaseUrl,
    authSession: createSession(async (url, init) => {
      calls.push({ url: String(url), init })
      return response(200, {
        status: 'success',
        data: { recorded: true, faultCount: 1, maxFaults: 3, autoSubmitted: false },
      })
    }),
  })
  assert.deepEqual(await api.reportSecurityViolation(exam.id, 'copy_blocked'), { recorded: true })
  assert.deepEqual(await api.recordExamFault(exam.id, 'window_blur'), {
    faultCount: 1,
    maxFaults: 3,
    autoSubmitted: false,
  })
  assert.equal(calls[0].url, `${apiBaseUrl}/exams/student/${exam.id}/log-cheating`)
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'copy_blocked' })
  assert.equal(calls[1].url, `${apiBaseUrl}/exams/student/${exam.id}/record-fault`)
  assert.deepEqual(JSON.parse(calls[1].init.body), { reason: 'window_blur' })
  await assert.rejects(api.reportSecurityViolation(exam.id, 'arbitrary-action'), /invalid/)
  await assert.rejects(api.recordExamFault(exam.id, 'arbitrary-reason'), /invalid/)
  assert.equal(calls.length, 2)
})
