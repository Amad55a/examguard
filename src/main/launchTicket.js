const MAX_TICKET_LENGTH = 128
const API_TIMEOUT_MS = 15_000
const MAX_ANSWER_PAYLOAD_BYTES = 1_000_000
const NETWORK_ERROR_CODES = new Set([
  'ABORT_ERR',
  'CERT_HAS_EXPIRED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID',
  'ERR_CERT_DATE_INVALID',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_NETWORK_CHANGED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'TimeoutError',
])
const RUNNABLE_LANGUAGES = new Set(['python', 'javascript', 'c', 'cpp', 'csharp'])
const SECURITY_VIOLATIONS = new Set([
  'copy_blocked',
  'paste_blocked',
  'right_click_blocked',
  'devtools_suspected',
])
const QUESTION_TYPES = new Set([
  'mcq',
  'truefalse',
  'essay',
  'lab',
  'os_windows',
  'os_linux',
  'design_lab',
  'networking_lab',
])
const SUBMISSION_STATUSES = new Set([
  'not-started',
  'in-progress',
  'submitted',
  'auto-graded',
  'manual-review',
  'graded',
  'published',
])

function safeMessage(status, fallback, path) {
  if (status === 401 && path.startsWith('auth/')) {
    return 'Your saved UniCORE session has expired. Return to the portal and open the exam again to get a fresh launch ticket.'
  }
  if (status === 401 && path.endsWith('/launch-ticket/redeem')) {
    return 'This launch ticket is invalid, expired, or already used. Return to the portal and open the exam again for a new ticket.'
  }
  if (status === 410 && (path.includes('/start') || path.includes('/autosave') || path.includes('/submit'))) {
    return 'The exam deadline has passed.'
  }
  if (status === 410 && path.endsWith('/launch-ticket/redeem')) {
    return 'This launch ticket is invalid, expired, or already used. Return to the portal and open the exam again for a new ticket.'
  }
  if (status === 401) return 'Your UniCORE exam session has expired. Return to the portal and open the exam again.'
  if (status === 410) return 'This launch request is no longer valid. Return to the portal and open the exam again.'
  if (status === 403 || status === 428) return 'This exam is unavailable for ExamGuard.'
  if (status === 409) return 'A newer answer update exists. Refresh the saved session before retrying.'
  if (status === 429) return 'Too many launch attempts. Please wait and try again.'
  if (status >= 500) return 'UniCORE is temporarily unavailable. Check your connection and try again later.'
  return fallback
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getSafeNetworkErrorCode(error) {
  const candidates = [error?.code, error?.cause?.code, error?.name, error?.cause?.name]
  const directMatch = candidates.find((candidate) => NETWORK_ERROR_CODES.has(candidate))
  if (directMatch) return directMatch
  const messageMatch = [...NETWORK_ERROR_CODES].find((candidate) =>
    (error?.message || error?.cause?.message || '').includes(candidate),
  )
  return messageMatch || 'NETWORK_ERROR'
}

function networkErrorMessage(code) {
  if (['ETIMEDOUT', 'ABORT_ERR', 'TimeoutError', 'ERR_CONNECTION_TIMED_OUT'].includes(code)) {
    return 'The UniCORE API request timed out. Check your connection and try again.'
  }
  if (['ECONNREFUSED', 'ERR_CONNECTION_REFUSED'].includes(code)) {
    return 'Could not connect to the configured UniCORE API. Check that the backend is running and the API URL is correct.'
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'ERR_NAME_NOT_RESOLVED'].includes(code)) {
    return 'The configured UniCORE API hostname could not be resolved. Check the API URL and your network.'
  }
  if (code.startsWith('ERR_CERT_') || code.startsWith('ERR_TLS_') || code === 'CERT_HAS_EXPIRED') {
    return 'The secure connection to UniCORE failed certificate verification. Check your system clock or network configuration.'
  }
  if (['ERR_INTERNET_DISCONNECTED', 'ERR_NETWORK_CHANGED', 'ENETUNREACH'].includes(code)) {
    return 'UniCORE could not be reached because the network is unavailable.'
  }
  return 'UniCORE could not be reached. Check your connection and try again.'
}

function pickUser(value) {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.email !== 'string' ||
    value.role !== 'student'
  ) {
    throw new Error('The authentication response was invalid.')
  }
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    fullName: typeof value.fullName === 'string' ? value.fullName : value.name || '',
    email: value.email,
    role: 'student',
  }
}

function pickExam(value, { fromSession = false, apiOrigin } = {}) {
  const id = typeof value?._id === 'string' ? value._id : value?.id
  if (!isRecord(value) || typeof id !== 'string' || typeof value.title !== 'string') {
    throw new Error('The exam response was invalid.')
  }
  const security = isRecord(value.security)
    ? {
        cameraRequired: value.security.cameraRequired === true,
        microphoneRequired: value.security.microphoneRequired === true,
        fullscreenRequired: value.security.fullscreenRequired !== false,
        browserLock: value.security.browserLock === true,
        disableCopy: value.security.disableCopy !== false,
        disablePaste: value.security.disablePaste !== false,
        disableRightClick: value.security.disableRightClick !== false,
        detectTabSwitch: value.security.detectTabSwitch !== false,
        autoSubmit: value.security.autoSubmit !== false,
        recordViolations: value.security.recordViolations !== false,
      }
    : undefined
  return {
    id,
    title: value.title,
    timeLimit: Number.isFinite(value.timeLimit) ? value.timeLimit : null,
    availableUntil: typeof value.availableUntil === 'string' ? value.availableUntil : null,
    sessionEndsAt: typeof (value.sessionEndsAt || value.endTime) === 'string'
      ? value.sessionEndsAt || value.endTime
      : null,
    ...(typeof value.instructions === 'string'
      ? { instructions: value.instructions.slice(0, 10_000) }
      : {}),
    ...(security ? { security } : {}),
    ...(fromSession ? { questions: pickQuestions(value.questions, apiOrigin) } : {}),
  }
}

function pickQuestionImage(value, apiOrigin) {
  if (typeof value !== 'string' || value.length > 2_800_000) return ''
  if (/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/i.test(value)) {
    return value
  }
  try {
    const imageUrl = new URL(value, apiOrigin)
    if (
      imageUrl.protocol === 'https:' &&
      !imageUrl.username &&
      !imageUrl.password &&
      !imageUrl.hash &&
      (imageUrl.origin === apiOrigin || imageUrl.hostname === 'res.cloudinary.com')
    ) {
      return imageUrl.href
    }
  } catch {
    return ''
  }
  return ''
}

function pickQuestions(value, apiOrigin) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('UniCORE returned an invalid exam question list.')
  }
  return value.map((question) => {
    if (
      !isRecord(question) ||
      typeof question._id !== 'string' ||
      !QUESTION_TYPES.has(question.type) ||
      typeof question.question !== 'string'
    ) {
      throw new Error('UniCORE returned an unsupported or invalid question.')
    }
    const image = pickQuestionImage(question.image, apiOrigin)
    const picked = {
      id: question._id,
      type: question.type,
      question: question.question,
      marks: Number.isFinite(question.marks) ? question.marks : null,
      hasImage: Boolean(image),
      ...(image ? { image } : {}),
    }
    if (question.type === 'mcq') {
      if (!Array.isArray(question.options) || question.options.some((option) => typeof option !== 'string')) {
        throw new Error('UniCORE returned invalid multiple-choice options.')
      }
      picked.options = [...question.options]
    }
    if (Number.isFinite(question.wordLimit)) picked.wordLimit = question.wordLimit
    if (typeof question.environment === 'string') picked.environment = question.environment
    if (Array.isArray(question.allowedLanguages)) {
      picked.allowedLanguages = question.allowedLanguages.filter((language) => typeof language === 'string')
    }
    if (Array.isArray(question.designResources)) {
      picked.designResources = question.designResources.filter((resource) => typeof resource === 'string')
    }
    if (Array.isArray(question.designColors)) {
      picked.designColors = question.designColors.filter((color) => typeof color === 'string')
    }
    if (Array.isArray(question.designTemplates)) {
      picked.designTemplates = question.designTemplates.filter((template) => typeof template === 'string')
    }
    if (typeof question.sqlSchema === 'string') {
      picked.sqlSchema = question.sqlSchema.slice(0, 50_000)
    }
    if (Array.isArray(question.hints)) {
      picked.hints = question.hints.filter((hint) => typeof hint === 'string').slice(0, 50)
    }
    if (isRecord(question.starterCode)) {
      picked.starterCode = Object.fromEntries(
        Object.entries(question.starterCode).filter(([, source]) => typeof source === 'string'),
      )
    }
    return picked
  })
}

function copyAnswerValue(value) {
  if (value === undefined) return undefined
  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('An answer could not be prepared for saving.')
  }
  if (serialized === undefined || serialized.length > MAX_ANSWER_PAYLOAD_BYTES) {
    throw new Error('The answer is too large to save.')
  }
  try {
    return JSON.parse(serialized)
  } catch {
    throw new Error('An answer could not be prepared for saving.')
  }
}

function pickAnswers(value, questions) {
  if (!Array.isArray(value) || value.length > questions.length) {
    throw new Error('The saved answer list was invalid.')
  }
  const questionTypes = new Map(questions.map((question) => [question.id, question.type]))
  const answers = value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.questionId !== 'string' ||
      questionTypes.get(entry.questionId) !== entry.type
    ) {
      throw new Error('The saved answer list was invalid.')
    }
    return {
      questionId: entry.questionId,
      type: entry.type,
      answer: copyAnswerValue(entry.answer),
      codeOutput: typeof entry.codeOutput === 'string' ? entry.codeOutput.slice(0, 100_000) : '',
    }
  })
  if (JSON.stringify(answers).length > MAX_ANSWER_PAYLOAD_BYTES) {
    throw new Error('The answer set is too large to save.')
  }
  return answers
}

export function createLaunchTicketApi({ apiBaseUrl, authSession }) {
  const base = apiBaseUrl ? new URL(`${apiBaseUrl.replace(/\/+$/, '')}/`) : null
  const apiOrigin = base?.origin
  const questionSets = new Map()

  async function request(path, { method = 'GET', body } = {}) {
    if (!base) throw new Error('The ExamGuard API endpoint is not configured.')
    const url = new URL(path.replace(/^\/+/, ''), base)
    if (url.origin !== apiOrigin || !url.pathname.startsWith(base.pathname)) {
      throw new Error('The ExamGuard API request was rejected.')
    }

    let response
    try {
      response = await authSession.fetch(url, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
        redirect: 'error',
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      })
    } catch (cause) {
      const code = getSafeNetworkErrorCode(cause)
      console.warn('[ExamGuard API] Request failed', {
        method,
        path: url.pathname,
        origin: apiOrigin,
        code,
      })
      const error = new Error(networkErrorMessage(code))
      error.retryable = true
      error.code = code
      throw error
    }

    let payload
    try {
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new Error('Expected JSON')
      }
      payload = await response.json()
    } catch {
      throw new Error('UniCORE returned an invalid response.')
    }

    if (!response.ok) {
      const error = new Error(
        safeMessage(response.status, 'UniCORE could not complete the request.', path),
      )
      error.status = response.status
      error.retryable = response.status >= 500
      throw error
    }
    if (
      !isRecord(payload) ||
      (payload.success !== true && payload.status !== 'success') ||
      (payload.data !== null && !isRecord(payload.data))
    ) {
      throw new Error('UniCORE returned an invalid response.')
    }

    return payload.data
  }

  async function refresh() {
    await request('auth/refresh-token', { method: 'POST', body: {} })
  }

  async function startExam(examId) {
    if (typeof examId !== 'string' || !/^[a-f\d]{24}$/i.test(examId)) {
      throw new Error('The exam session is unavailable. Redeem a new launch ticket.')
    }
    const data = await protectedRequest(`exams/student/${examId}/start`)
    if (
      !isRecord(data) ||
      !isRecord(data.exam) ||
      typeof data.submissionId !== 'string'
    ) {
      throw new Error('UniCORE returned an invalid exam session.')
    }
    const exam = pickExam(data.exam, { fromSession: true, apiOrigin })
    if (exam.id !== examId) throw new Error('UniCORE returned a different exam session.')
    questionSets.set(examId, exam.questions)
    const answers = pickAnswers(data.answers || [], exam.questions)
    const answerRevision = Number.isSafeInteger(data.answerRevision) && data.answerRevision >= 0
      ? data.answerRevision
      : 0
    const serverTime = typeof data.serverTime === 'string' ? data.serverTime : null
    const { questions, ...examSummary } = exam
    return {
      submissionId: data.submissionId,
      exam: examSummary,
      questions,
      answers,
      answerRevision,
      serverTime,
    }
  }

  function validateAnswerPayload(examId, payload) {
    if (
      !isRecord(payload) ||
      !Number.isSafeInteger(payload.clientRevision) ||
      payload.clientRevision < 1
    ) {
      throw new Error('The answer update was invalid.')
    }
    const questions = questionSets.get(examId)
    if (!questions) throw new Error('Load the exam session before saving answers.')
    const answers = pickAnswers(payload.answers, questions)
    const body = { answers, clientRevision: payload.clientRevision }
    if (JSON.stringify(body).length > MAX_ANSWER_PAYLOAD_BYTES) {
      throw new Error('The answer set is too large to save.')
    }
    return body
  }

  let refreshInFlight = null
  async function protectedRequest(path, options) {
    try {
      return await request(path, options)
    } catch (error) {
      if (error.status !== 401) throw error
      if (!refreshInFlight) {
        refreshInFlight = refresh().finally(() => {
          refreshInFlight = null
        })
      }
      await refreshInFlight
      return request(path, options)
    }
  }

  return Object.freeze({
    async redeemLaunchTicket(ticket) {
      if (
        typeof ticket !== 'string' ||
        ticket.length > MAX_TICKET_LENGTH ||
        !/^[A-Za-z0-9_-]{43}$/.test(ticket)
      ) {
        throw new Error('Enter a valid launch ticket.')
      }

      const data = await request('exams/student/launch-ticket/redeem', {
        method: 'POST',
        body: { ticket },
      })
      return { user: pickUser(data.user), exam: pickExam(data.exam) }
    },

    async getCurrentUser() {
      const data = await protectedRequest('auth/me')
      const user = data.id
        ? data
        : data.user
      return { user: pickUser(user) }
    },

    startExam,

    async getExamSessionStatus(examId) {
      if (typeof examId !== 'string' || !/^[a-f\d]{24}$/i.test(examId)) {
        throw new Error('The exam session is unavailable. Redeem a new launch ticket.')
      }
      const data = await protectedRequest(`exams/student/${examId}/session-status`)
      if (
        !isRecord(data) ||
        !SUBMISSION_STATUSES.has(data.status) ||
        data.examId !== examId ||
        !Number.isSafeInteger(data.answerRevision) ||
        data.answerRevision < 0
      ) {
        throw new Error('UniCORE returned an invalid exam session status.')
      }
      return {
        status: data.status,
        sessionEndsAt: typeof data.sessionEndsAt === 'string' ? data.sessionEndsAt : null,
        submittedAt: typeof data.submittedAt === 'string' ? data.submittedAt : null,
        answerRevision: data.answerRevision,
        serverTime: typeof data.serverTime === 'string' ? data.serverTime : null,
      }
    },

    async autosaveAnswers(examId, payload) {
      const body = validateAnswerPayload(examId, payload)
      let data
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          data = await protectedRequest(`exams/student/${examId}/autosave`, {
            method: 'POST',
            body,
          })
          break
        } catch (error) {
          if (attempt === 0 && error.retryable) continue
          throw error
        }
      }
      if (!isRecord(data) || data.answerRevision !== body.clientRevision) {
        throw new Error('UniCORE did not confirm that the answers were saved.')
      }
      return { answerRevision: data.answerRevision }
    },

    async runCode(examId, payload) {
      if (
        typeof examId !== 'string' ||
        !/^[a-f\d]{24}$/i.test(examId) ||
        !isRecord(payload) ||
        Object.keys(payload).some((key) => !['questionId', 'language', 'code', 'stdin'].includes(key)) ||
        typeof payload.questionId !== 'string' ||
        !/^[a-f\d]{24}$/i.test(payload.questionId) ||
        typeof payload.language !== 'string' ||
        typeof payload.code !== 'string' ||
        payload.code.length === 0 ||
        payload.code.length > 50_000 ||
        (payload.stdin !== undefined && (typeof payload.stdin !== 'string' || payload.stdin.length > 20_000))
      ) {
        throw new Error('The code execution request was invalid.')
      }
      const question = questionSets.get(examId)?.find((entry) => entry.id === payload.questionId)
      if (
        !question ||
        question.type !== 'lab' ||
        !RUNNABLE_LANGUAGES.has(payload.language) ||
        !question.allowedLanguages?.includes(payload.language)
      ) {
        throw new Error('Code execution is not enabled for this question and language.')
      }
      const data = await protectedRequest(
        `exams/student/${examId}/questions/${payload.questionId}/run`,
        {
          method: 'POST',
          body: {
            language: payload.language,
            code: payload.code,
            stdin: payload.stdin || '',
          },
        },
      )
      if (
        !isRecord(data) ||
        typeof data.ok !== 'boolean' ||
        typeof data.output !== 'string' ||
        !Number.isInteger(data.exitCode) ||
        (data.executionTime !== null && !Number.isFinite(data.executionTime)) ||
        typeof data.timedOut !== 'boolean'
      ) {
        throw new Error('UniCORE returned an invalid code execution result.')
      }
      return {
        ok: data.ok,
        output: data.output.slice(0, 20_000),
        exitCode: data.exitCode,
        executionTime: data.executionTime,
        timedOut: data.timedOut,
      }
    },

    async sendProctorHeartbeat(examId, payload) {
      if (
        typeof examId !== 'string' ||
        !/^[a-f\d]{24}$/i.test(examId) ||
        !isRecord(payload) ||
        Object.keys(payload).some((key) =>
          !['cameraOk', 'microphoneOk', 'snapshot', 'note'].includes(key)) ||
        (typeof payload.cameraOk !== 'boolean' && typeof payload.microphoneOk !== 'boolean') ||
        (payload.cameraOk !== undefined && typeof payload.cameraOk !== 'boolean') ||
        (payload.microphoneOk !== undefined && typeof payload.microphoneOk !== 'boolean') ||
        (payload.snapshot !== undefined &&
          (payload.cameraOk !== true ||
            typeof payload.snapshot !== 'string' ||
            payload.snapshot.length > 380_000 ||
            !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/i.test(payload.snapshot))) ||
        (payload.note !== undefined &&
          ![
            'camera_denied',
            'camera_lost',
            'camera_unavailable',
            'microphone_denied',
            'microphone_lost',
            'microphone_unavailable',
          ].includes(payload.note))
      ) {
        throw new Error('The proctoring device status update was invalid.')
      }
      const data = await protectedRequest(`exams/student/${examId}/proctor-heartbeat`, {
        method: 'POST',
        body: payload,
      })
      if (!isRecord(data) || data.recorded !== true) {
        throw new Error('UniCORE did not confirm the proctoring device status update.')
      }
      return { recorded: true }
    },

    async reportSecurityViolation(examId, action) {
      if (
        typeof examId !== 'string' ||
        !/^[a-f\d]{24}$/i.test(examId) ||
        !SECURITY_VIOLATIONS.has(action)
      ) {
        throw new Error('The exam security event was invalid.')
      }
      const data = await protectedRequest(`exams/student/${examId}/log-cheating`, {
        method: 'POST',
        body: { action },
      })
      if (data !== null && (!isRecord(data) || typeof data.recorded !== 'boolean')) {
        throw new Error('UniCORE returned an invalid exam security event response.')
      }
      return { recorded: data?.recorded === true }
    },

    async recordExamFault(examId, reason) {
      if (
        typeof examId !== 'string' ||
        !/^[a-f\d]{24}$/i.test(examId) ||
        !['window_blur', 'fullscreen_exit', 'minimize'].includes(reason)
      ) {
        throw new Error('The exam security event was invalid.')
      }
      const data = await protectedRequest(`exams/student/${examId}/record-fault`, {
        method: 'POST',
        body: { reason },
      })
      if (
        !isRecord(data) ||
        !Number.isSafeInteger(data.faultCount) ||
        !Number.isSafeInteger(data.maxFaults) ||
        typeof data.autoSubmitted !== 'boolean'
      ) {
        throw new Error('UniCORE did not confirm the exam security event.')
      }
      return {
        faultCount: data.faultCount,
        maxFaults: data.maxFaults,
        autoSubmitted: data.autoSubmitted,
      }
    },

    async submitExam(examId, payload) {
      const body = validateAnswerPayload(examId, payload)
      const data = await protectedRequest(`exams/student/${examId}/submit`, {
        method: 'POST',
        body,
      })
      if (!isRecord(data) || !isRecord(data.submission) || typeof data.submission.status !== 'string') {
        throw new Error('UniCORE did not confirm the exam submission.')
      }
      return {
        status: data.submission.status,
        submittedAt: typeof data.submission.submittedAt === 'string'
          ? data.submission.submittedAt
          : null,
      }
    },

    async logout() {
      try {
        await request('auth/logout', { method: 'POST', body: {} })
        return { ok: true }
      } catch {
        return {
          ok: false,
          message: 'Signed out on this device, but UniCORE could not confirm server-side logout.',
        }
      } finally {
        const cookies = await authSession.cookies.get(apiOrigin ? { url: apiOrigin } : {})
        await Promise.all(
          cookies
            .filter((cookie) => ['accessToken', 'refreshToken'].includes(cookie.name))
            .map((cookie) => {
              const protocol = cookie.secure ? 'https:' : 'http:'
              const host = cookie.domain.replace(/^\./, '')
              return authSession.cookies.remove(
                `${protocol}//${host}${cookie.path || '/'}`,
                cookie.name,
              )
            }),
        )
      }
    },
  })
}
