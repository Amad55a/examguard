import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerLaunchTicketIpc } from './launchTicketIpc.js'

function createHarness() {
  const handlers = new Map()
  const calls = []
  let savedSession = null
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) }
  const api = {
    redeemLaunchTicket: async (ticket) => {
      calls.push(['redeem', ticket])
      return {
        user: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'student' },
        exam: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Midterm' },
      }
    },
    getCurrentUser: async () => ({ user: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'student' } }),
    getExamSessionStatus: async () => ({
      status: 'in-progress',
      answerRevision: 2,
    }),
    startExam: async (examId) => {
      calls.push(['start', examId])
      return { submissionId: 'submission-1' }
    },
    autosaveAnswers: async (examId, payload) => {
      calls.push(['autosave', examId, payload])
      return { answerRevision: payload.clientRevision }
    },
    runCode: async (examId, payload) => {
      calls.push(['run-code', examId, payload])
      return { ok: true, output: '42', exitCode: 0, executionTime: 12, timedOut: false }
    },
    sendProctorHeartbeat: async (examId, payload) => {
      calls.push(['proctor-heartbeat', examId, payload])
      return { recorded: true }
    },
    reportSecurityViolation: async (examId, action) => {
      calls.push(['security-violation', examId, action])
      return { recorded: true }
    },
    submitExam: async (examId, payload) => {
      calls.push(['submit', examId, payload])
      return { status: 'submitted' }
    },
    logout: async () => ({ ok: true }),
  }
  const store = {
    get: () => savedSession,
    set: (value) => { savedSession = value },
    clear: () => { savedSession = null },
  }
  const assertTrustedMainFrame = (event) => {
    if (!event.trusted) throw new Error('untrusted sender')
  }
  registerLaunchTicketIpc(ipcMain, api, assertTrustedMainFrame, store)
  return { handlers, calls, store }
}

test('registers only fixed ticket, session, save, run, and submit operations', async () => {
  const { handlers, calls, store } = createHarness()
  assert.deepEqual([...handlers.keys()].sort(), [
    'examguard:autosave-answers',
    'examguard:get-current-user',
    'examguard:get-exam-session',
    'examguard:get-session-status',
    'examguard:logout',
    'examguard:proctor-heartbeat',
    'examguard:redeem-launch-ticket',
    'examguard:report-security-violation',
    'examguard:run-code',
    'examguard:start-exam',
    'examguard:submit-exam',
  ])
  assert.equal(handlers.has('examguard:request'), false)
  assert.equal(handlers.has('examguard:fetch'), false)

  const trusted = { trusted: true }
  await assert.rejects(handlers.get('examguard:start-exam')(trusted), /Redeem a launch ticket/)
  await handlers.get('examguard:redeem-launch-ticket')(trusted, 'one-time-ticket')
  await handlers.get('examguard:start-exam')(trusted)
  await handlers.get('examguard:autosave-answers')(trusted, {
    answers: [],
    clientRevision: 1,
  })
  await handlers.get('examguard:run-code')(trusted, {
    questionId: 'cccccccccccccccccccccccc',
    language: 'python',
    code: 'print(42)',
  })
  await handlers.get('examguard:submit-exam')(trusted, {
    answers: [],
    clientRevision: 2,
  })
  await handlers.get('examguard:logout')(trusted)
  assert.equal(store.get(), null)
  await assert.rejects(
    handlers.get('examguard:get-current-user')({ trusted: false }),
    /untrusted sender/,
  )
  assert.deepEqual(calls, [
    ['redeem', 'one-time-ticket'],
    ['start', 'bbbbbbbbbbbbbbbbbbbbbbbb'],
    ['autosave', 'bbbbbbbbbbbbbbbbbbbbbbbb', { answers: [], clientRevision: 1 }],
    ['run-code', 'bbbbbbbbbbbbbbbbbbbbbbbb', {
      questionId: 'cccccccccccccccccccccccc',
      language: 'python',
      code: 'print(42)',
    }],
    ['submit', 'bbbbbbbbbbbbbbbbbbbbbbbb', { answers: [], clientRevision: 2 }],
  ])
})

test('restores an in-progress exam using saved server state and binds it to its student', async () => {
  const { handlers, store } = createHarness()
  const trusted = { trusted: true }
  await handlers.get('examguard:redeem-launch-ticket')(trusted, 'one-time-ticket')

  const restored = await handlers.get('examguard:get-exam-session')(trusted)
  assert.equal(restored.status, 'in-progress')
  assert.equal(restored.session.submissionId, 'submission-1')

  store.set({
    userId: 'cccccccccccccccccccccccc',
    exam: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Midterm' },
  })
  await assert.rejects(
    handlers.get('examguard:get-exam-session')(trusted),
    /another signed-in student/,
  )
  assert.equal(store.get(), null)
})

test('proctor heartbeat IPC requires a camera-enabled exam', async () => {
  const { handlers, store, calls } = createHarness()
  const trusted = { trusted: true }
  store.set({
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    exam: {
      id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      title: 'Midterm',
      security: { cameraRequired: true, microphoneRequired: false, fullscreenRequired: false },
    },
  })
  await handlers.get('examguard:get-current-user')(trusted)
  await handlers.get('examguard:proctor-heartbeat')(trusted, { cameraOk: true })
  assert.deepEqual(calls, [[
    'proctor-heartbeat',
    'bbbbbbbbbbbbbbbbbbbbbbbb',
    { cameraOk: true },
  ]])

  store.set({
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    exam: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Midterm' },
  })
  await assert.rejects(
    handlers.get('examguard:proctor-heartbeat')(trusted, { cameraOk: true }),
    /not enabled/,
  )
})

test('will not start or resume exams requiring unsupported security features', async () => {
  const { handlers, store } = createHarness()
  const trusted = { trusted: true }
  store.set({
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    exam: {
      id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      title: 'Midterm',
      security: {
        cameraRequired: false,
        microphoneRequired: true,
        fullscreenRequired: true,
        browserLock: false,
      },
    },
  })

  test('records only enabled security restrictions for the active exam', async () => {
    const { handlers, store, calls } = createHarness()
    const trusted = { trusted: true }
    store.set({
      userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      exam: {
        id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        title: 'Midterm',
        security: {
          disableCopy: true,
          disablePaste: false,
          disableRightClick: false,
        },
      },
    })
    await handlers.get('examguard:get-current-user')(trusted)
    await handlers.get('examguard:report-security-violation')(trusted, 'copy_blocked')
    await assert.rejects(
      handlers.get('examguard:report-security-violation')(trusted, 'paste_blocked'),
      /not enabled/,
    )
    assert.deepEqual(calls, [[
      'security-violation',
      'bbbbbbbbbbbbbbbbbbbbbbbb',
      'copy_blocked',
    ]])
  })
  await handlers.get('examguard:get-current-user')(trusted)
  await assert.rejects(handlers.get('examguard:start-exam')(trusted), /security features/)
})
