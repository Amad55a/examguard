export function getExamGuardLabMode() {
  const candidate = typeof globalThis !== 'undefined' ? globalThis.window : undefined
  return candidate && typeof candidate.examGuard?.runCode === 'function' ? 'examguard' : 'legacy'
}

export function buildCodeExecutionRequest({ questionId, language, code, stdin = '' }) {
  return { questionId, language, code, stdin }
}

export function answersToMap(questions, savedAnswers = []) {
  const questionTypes = new Map(questions.map((question) => [question.id, question.type]))
  const answerMap = {}
  for (const entry of savedAnswers) {
    if (
      entry &&
      typeof entry.questionId === 'string' &&
      questionTypes.get(entry.questionId) === entry.type
    ) {
      answerMap[entry.questionId] = {
        questionId: entry.questionId,
        type: entry.type,
        answer: entry.answer,
        codeOutput: typeof entry.codeOutput === 'string' ? entry.codeOutput : '',
      }
    }
  }
  return answerMap
}

export function answersToList(questions, answerMap) {
  return questions.flatMap((question) => {
    const entry = answerMap[question.id]
    if (!entry) return []
    return [{
      questionId: question.id,
      type: question.type,
      answer: entry.answer,
      codeOutput: typeof entry.codeOutput === 'string' ? entry.codeOutput : '',
    }]
  })
}

export function isQuestionAnswered(answer) {
  if (!answer || answer.answer === undefined || answer.answer === null) return false
  if (typeof answer.answer === 'string') return answer.answer.trim().length > 0
  if (Array.isArray(answer.answer)) return answer.answer.length > 0
  if (typeof answer.answer === 'object') return Object.keys(answer.answer).length > 0
  return true
}

export function secondsRemaining(sessionEndsAt, serverOffsetMs = 0, now = Date.now()) {
  const deadline = Date.parse(sessionEndsAt)
  if (!Number.isFinite(deadline)) return 0
  return Math.max(0, Math.ceil((deadline - (now + serverOffsetMs)) / 1000))
}

export function formatRemainingTime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

export function createAutosaveQueue(save) {
  let tail = Promise.resolve()
  return (payload) => {
    const operation = tail.then(() => save(payload))
    tail = operation.catch(() => {})
    return operation
  }
}
