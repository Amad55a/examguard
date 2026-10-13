import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import examGuardIcon from '../../../images/07_icon_only_round.png'
import ExamGuardCameraMonitor from './ExamGuardCameraMonitor.jsx'
import { getSessionRecoveryMessage } from './sessionRecovery.js'
import { StudentCodingLab } from './teacher/components/CodingLab.jsx'
import LinuxLab from './teacher/components/LinuxLab.jsx'
import DesignLab from './teacher/components/DesignLab.jsx'
import {
  answersToList,
  answersToMap,
  createAutosaveQueue,
  formatRemainingTime,
  isQuestionAnswered,
  secondsRemaining,
} from './examWorkspace.js'

const ticketPattern = /^[A-Za-z0-9_-]{43}$/
const finalStatuses = new Set(['submitted', 'auto-graded', 'manual-review', 'graded', 'published'])

function getAnswerText(answer, fallback = '') {
  if (typeof answer === 'string') return answer
  if (answer === undefined || answer === null) return fallback
  try {
    return JSON.stringify(answer, null, 2)
  } catch {
    return fallback
  }
}

function parseAnswerText(value) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function getStarterCode(question) {
  const choices = Object.entries(question.starterCode || {})
  const language = question.allowedLanguages?.[0]
  const match = choices.find(([name]) => name === language) || choices[0]
  return match?.[1] || ''
}

function App() {
  const [ticket, setTicket] = useState('')
  const [user, setUser] = useState(null)
  const [exam, setExam] = useState(null)
  const [session, setSession] = useState(null)
  const [answers, setAnswers] = useState({})
  const [questionIndex, setQuestionIndex] = useState(0)
  const [stage, setStage] = useState('checking')
  const [message, setMessage] = useState('Checking desktop session…')
  const [isBusy, setIsBusy] = useState(true)
  const [isError, setIsError] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [answerRevision, setAnswerRevision] = useState(0)
  const [savedRevision, setSavedRevision] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [serverOffsetMs, setServerOffsetMs] = useState(0)
  const [deadlineLocked, setDeadlineLocked] = useState(false)
  const [deadlineCheckFailed, setDeadlineCheckFailed] = useState(false)
  const [submitConfirmation, setSubmitConfirmation] = useState(false)
  const [submissionUncertain, setSubmissionUncertain] = useState(false)
  const [finalStatus, setFinalStatus] = useState(null)
  const [submittedAt, setSubmittedAt] = useState(null)
  const [codeLanguage, setCodeLanguage] = useState('')
  const [isRunningCode, setIsRunningCode] = useState(false)
  const [codeRunError, setCodeRunError] = useState('')
  const [securityMessage, setSecurityMessage] = useState('')

  const answersRef = useRef(answers)
  const revisionRef = useRef(0)
  const savedRevisionRef = useRef(0)
  const saveTimerRef = useRef(null)
  const lastSavePromiseRef = useRef(Promise.resolve())
  const submitLockRef = useRef(false)
  const deadlineCheckRef = useRef(false)
  const deepLinkRefreshRef = useRef(0)

  const [enqueueSave] = useState(() => createAutosaveQueue(async (payload) => {
      try {
        return await window.examGuard.autosaveAnswers(payload)
      } catch (error) {
        if (!error.retryable) throw error
        return window.examGuard.autosaveAnswers(payload)
      }
  }))

  const questions = useMemo(() => session?.questions || [], [session])
  const activeQuestion = questions[questionIndex] || null
  const allowedCodeLanguages = activeQuestion?.allowedLanguages || []
  const answerForActiveQuestion = activeQuestion ? answers[activeQuestion.id]?.answer : undefined
  const selectedCodeLanguage = allowedCodeLanguages.includes(codeLanguage)
    ? codeLanguage
    : allowedCodeLanguages.includes(answerForActiveQuestion?.langId)
      ? answerForActiveQuestion.langId
    : allowedCodeLanguages[0] || Object.keys(activeQuestion?.starterCode || {})[0] || ''
  const activeCode = answerForActiveQuestion && typeof answerForActiveQuestion === 'object'
    ? answerForActiveQuestion.codes?.[selectedCodeLanguage] ??
      (answerForActiveQuestion.langId === selectedCodeLanguage ? answerForActiveQuestion.code : undefined)
    : typeof answerForActiveQuestion === 'string' ? answerForActiveQuestion : undefined
  const unansweredNumbers = useMemo(
    () => questions.flatMap((question, index) =>
      isQuestionAnswered(answers[question.id]) ? [] : [index + 1],
    ),
    [answers, questions],
  )
  const answeredCount = questions.length - unansweredNumbers.length

  const setFinalState = useCallback((status, date = null) => {
    setFinalStatus(status)
    setSubmittedAt(date)
    setSubmissionUncertain(false)
    setDeadlineLocked(true)
    setDeadlineCheckFailed(false)
    setStage('submitted')
    setIsBusy(false)
  }, [])

  useEffect(() => window.examGuard.onSecurityEvent((event) => {
    if (event?.autoSubmitted) {
      setFinalState('submitted')
      setSecurityMessage('UniCORE auto-submitted the exam after repeated security faults.')
    } else if (event?.error) {
      setSecurityMessage(event.error)
    } else if (event?.faultCount) {
      setSecurityMessage(
        `Security event recorded (${event.faultCount}/${event.maxFaults} allowed faults).`,
      )
    } else if (event?.violation) {
      setSecurityMessage(event.recorded
        ? 'Exam security event recorded by UniCORE.'
        : 'This exam is configured not to record individual security events.')
    } else if (event?.closeBlocked) {
      setSecurityMessage('Submit the exam using the exam controls before closing ExamGuard.')
    }
  }), [setFinalState])

  const hydrateStartedSession = useCallback((startedSession) => {
    const initialAnswers = answersToMap(startedSession.questions, startedSession.answers)
    answersRef.current = initialAnswers
    setAnswers(initialAnswers)
    revisionRef.current = startedSession.answerRevision
    savedRevisionRef.current = startedSession.answerRevision
    setAnswerRevision(startedSession.answerRevision)
    setSavedRevision(startedSession.answerRevision)
    const serverTime = Date.parse(startedSession.serverTime)
    const offset = Number.isFinite(serverTime) ? serverTime - Date.now() : 0
    setServerOffsetMs(offset)
    setRemainingSeconds(secondsRemaining(
      startedSession.exam.sessionEndsAt,
      offset,
    ))
    setSession(startedSession)
    setExam(startedSession.exam)
    setQuestionIndex(0)
    setSaveStatus('saved')
    setDeadlineLocked(false)
    setDeadlineCheckFailed(false)
    setStage('exam')
    setIsBusy(false)
    setMessage('')
  }, [])

  const loadPersistedExam = useCallback(async (active) => {
    if (!active || active.status === 'none' || !active.exam) {
      setExam(null)
      setSession(null)
      setStage('connect')
      setMessage('Open an eligible exam from the UniCORE portal to receive a one-time launch ticket.')
      return
    }
    if (active.status === 'recovery') {
      setStage('connect')
      setMessage(getSessionRecoveryMessage(new Error(active.message || '')).message)
      setIsError(true)
      setIsBusy(false)
      return
    }
    setExam(active.exam)
    setSession(null)
    if (finalStatuses.has(active.status)) {
      setFinalState(active.status, active.submittedAt)
      return
    }
    if (active.status === 'in-progress' && active.session) {
      hydrateStartedSession(active.session)
      return
    }
    setStage('ready')
    setIsBusy(false)
    setMessage(active.status === 'not-started'
      ? 'Ticket accepted. Start when you are ready; the exam timer begins on start.'
      : 'The exam session is ready.')
  }, [hydrateStartedSession, setFinalState])

  useEffect(() => {
    let cancelled = false
    const restoreAfterDeepLink = async (status) => {
      if (!status || cancelled) return
      deepLinkRefreshRef.current += 1
      if (status.status !== 'redeemed') {
        setStage('connect')
        setMessage(getSessionRecoveryMessage(new Error(status.message || '')).message)
        setIsError(true)
        setIsBusy(false)
        return
      }
      setMessage('Launch ticket accepted. Checking your exam session…')
      setIsError(false)
      setIsBusy(true)
      try {
        const userResult = await window.examGuard.getCurrentUser()
        if (userResult.status === 'recovery') throw new Error(userResult.message)
        const { user: currentUser } = userResult
        if (cancelled) return
        setUser(currentUser)
        await loadPersistedExam(await window.examGuard.getExamSession())
      } catch (error) {
        if (cancelled) return
        setStage('connect')
        setMessage(getSessionRecoveryMessage(error).message)
        setIsError(true)
        setIsBusy(false)
      }
    }
    const unsubscribe = window.examGuard.onDeepLinkStatus(restoreAfterDeepLink)
    async function restoreSession() {
      const currentDeepLinkRefresh = deepLinkRefreshRef.current
      try {
        const active = await window.examGuard.getExamSession()
        if (cancelled || currentDeepLinkRefresh !== deepLinkRefreshRef.current) return
        if (active.status === 'recovery') throw new Error(active.message)
        if (active.status === 'none') {
          await loadPersistedExam(active)
          return
        }
        const userResult = await window.examGuard.getCurrentUser()
        if (userResult.status === 'recovery') throw new Error(userResult.message)
        const { user: currentUser } = userResult
        if (cancelled || currentDeepLinkRefresh !== deepLinkRefreshRef.current) return
        setUser(currentUser)
        await loadPersistedExam(active)
      } catch (error) {
        if (cancelled || currentDeepLinkRefresh !== deepLinkRefreshRef.current) return
        setStage('connect')
        setMessage(getSessionRecoveryMessage(error).message)
        setIsError(true)
        setIsBusy(false)
      }
    }
    void restoreSession()
    void Promise.resolve(window.examGuard.takePendingDeepLinkStatus()).then(restoreAfterDeepLink)
    return () => {
      cancelled = true
      unsubscribe()
      clearTimeout(saveTimerRef.current)
    }
  }, [loadPersistedExam])

  const openUniCorePortal = async () => {
    try {
      await window.examGuard.openPortal()
    } catch {
      setMessage('Could not open the portal automatically. Visit https://www.unicores.tech and open your exam from the student portal.')
      setIsError(true)
    }
  }

  const handleRedeem = async (event) => {
    event.preventDefault()
    setMessage('')
    setIsError(false)
    setIsBusy(true)
    try {
      if (!ticketPattern.test(ticket.trim())) {
        throw new Error('Enter the 43-character launch ticket from UniCORE.')
      }
      const result = await window.examGuard.redeemLaunchTicket(ticket.trim())
      if (result.status === 'recovery') throw new Error(result.message)
      setUser(result.user)
      setExam(result.exam)
      setStage('ready')
      setMessage('Ticket accepted. Checking the saved exam session…')
      setIsBusy(false)
      try {
        await loadPersistedExam(await window.examGuard.getExamSession())
      } catch (error) {
        setStage('ready')
        setMessage(`Ticket accepted, but the exam session could not be checked: ${error.message}`)
        setIsError(true)
      }
    } catch (error) {
      setMessage(getSessionRecoveryMessage(error).message)
      setIsError(true)
      setStage('connect')
      setIsBusy(false)
    } finally {
      setTicket('')
    }
  }

  const startExam = async () => {
    setIsBusy(true)
    setIsError(false)
    try {
      const started = await window.examGuard.startExam()
      hydrateStartedSession(started)
    } catch (error) {
      try {
        const status = await window.examGuard.getSessionStatus()
        if (finalStatuses.has(status.status)) {
          setFinalState(status.status, status.submittedAt)
          return
        }
      } catch {
        // The original start failure is the useful message; do not mask it.
      }
      setMessage(error.message || 'Unable to start the exam session.')
      setIsError(true)
      if (error.message?.includes('session expired')) setStage('session-expired')
      else if (error.message?.includes('unavailable for ExamGuard')) setStage('unavailable')
      setIsBusy(false)
    }
  }

  const queueAnswerSave = useCallback((snapshot, revision) => {
    const operation = enqueueSave({
      answers: answersToList(questions, snapshot),
      clientRevision: revision,
    })
    lastSavePromiseRef.current = operation
    setSaveStatus('saving')
    operation.then((result) => {
      savedRevisionRef.current = Math.max(savedRevisionRef.current, result.answerRevision)
      setSavedRevision(savedRevisionRef.current)
      if (revision >= revisionRef.current) setSaveStatus('saved')
    }).catch((error) => {
      if (revision >= revisionRef.current) {
        setSaveStatus('failed')
        setMessage(error.message || 'Answers were not confirmed as saved.')
        setIsError(true)
        if (error.message?.includes('session expired')) {
          setStage('session-expired')
        } else if (error.message?.includes('unavailable for ExamGuard')) {
          setStage('unavailable')
        }
      }
    })
    return operation
  }, [enqueueSave, questions])

  useEffect(() => {
    if (stage !== 'exam' || deadlineLocked || submissionUncertain || answerRevision <= savedRevision) return undefined
    clearTimeout(saveTimerRef.current)
    const snapshot = answers
    const revision = answerRevision
    saveTimerRef.current = setTimeout(() => {
      void queueAnswerSave(snapshot, revision)
    }, 700)
    return () => clearTimeout(saveTimerRef.current)
  }, [answers, answerRevision, deadlineLocked, queueAnswerSave, savedRevision, stage, submissionUncertain])

  const updateAnswer = (question, value, executionOutput) => {
    if (stage !== 'exam' || deadlineLocked || submissionUncertain || isBusy) return
    const existingAnswer = answersRef.current[question.id]
    const answerChanged = JSON.stringify(existingAnswer?.answer) !== JSON.stringify(value)
    const nextAnswers = {
      ...answersRef.current,
      [question.id]: {
        questionId: question.id,
        type: question.type,
        answer: value,
        codeOutput: typeof executionOutput === 'string'
          ? executionOutput
          : answerChanged && question.type === 'lab'
            ? ''
            : existingAnswer?.codeOutput || '',
      },
    }
    answersRef.current = nextAnswers
    setAnswers(nextAnswers)
    const nextRevision = Math.max(revisionRef.current, savedRevisionRef.current) + 1
    revisionRef.current = nextRevision
    setAnswerRevision(nextRevision)
    setSaveStatus('dirty')
    setIsError(false)
    setMessage('')
  }

  const runActiveCode = async () => {
    if (!activeQuestion || !selectedCodeLanguage || isRunningCode || isLocked) return
    setIsRunningCode(true)
    setCodeRunError('')
    try {
      const code = activeCode ??
        activeQuestion.starterCode?.[selectedCodeLanguage] ??
        (typeof activeQuestion.starterCode === 'string' ? activeQuestion.starterCode : '')
      const result = await window.examGuard.runCode({
        questionId: activeQuestion.id,
        language: selectedCodeLanguage,
        code,
      })
      const codeAnswer = {
        ...(answerForActiveQuestion && typeof answerForActiveQuestion === 'object'
          ? answerForActiveQuestion
          : {}),
        langId: selectedCodeLanguage,
        code,
        codes: {
          ...(answerForActiveQuestion?.codes || {}),
          [selectedCodeLanguage]: code,
        },
      }
      updateAnswer(
        activeQuestion,
        codeAnswer,
        result.output,
      )
    } catch (error) {
      setCodeRunError(error.message || 'Code could not be run. Check your connection and try again.')
    } finally {
      setIsRunningCode(false)
    }
  }

  const reconcileSession = useCallback(async () => {
    const status = await window.examGuard.getSessionStatus()
    if (finalStatuses.has(status.status)) {
      setFinalState(status.status, status.submittedAt)
      return status
    }
    if (status.status === 'in-progress') {
      savedRevisionRef.current = Math.max(savedRevisionRef.current, status.answerRevision)
      setSavedRevision(savedRevisionRef.current)
      const serverTime = Date.parse(status.serverTime)
      if (Number.isFinite(serverTime)) {
        const offset = serverTime - Date.now()
        setServerOffsetMs(offset)
      }
    }
    return status
  }, [setFinalState])

  const retrySave = async () => {
    setIsBusy(true)
    setIsError(false)
    try {
      const status = await reconcileSession()
      if (status.status !== 'in-progress') {
        setMessage('The server no longer reports an active exam.')
        setIsError(true)
        return
      }
      const started = await window.examGuard.startExam()
      const nextRevision = Math.max(
        revisionRef.current,
        savedRevisionRef.current,
        started.answerRevision,
      ) + 1
      revisionRef.current = nextRevision
      setAnswerRevision(nextRevision)
      setSaveStatus('dirty')
      setMessage('Retrying the current answers against the latest server revision.')
      setIsError(false)
      await queueAnswerSave(answersRef.current, nextRevision)
    } catch (error) {
      setMessage(error.message || 'Could not retry saving answers.')
      setIsError(true)
      setSaveStatus('failed')
    } finally {
      setIsBusy(false)
    }
  }

  const checkSubmissionStatus = async () => {
    setIsBusy(true)
    setIsError(false)
    try {
      const status = await reconcileSession()
      if (finalStatuses.has(status.status)) return
      if (status.status === 'in-progress') {
        setSubmissionUncertain(false)
        setMessage('UniCORE still reports this attempt in progress. Review your answers and submit again if needed.')
      } else {
        setMessage('The server has not confirmed a started attempt.')
      }
    } catch (error) {
      setMessage(error.message || 'Submission status could not be confirmed.')
      setIsError(true)
    } finally {
      setIsBusy(false)
    }
  }

  const confirmSubmit = async () => {
    if (submitLockRef.current || stage !== 'exam' || deadlineLocked) return
    submitLockRef.current = true
    setSubmitConfirmation(false)
    setIsBusy(true)
    setIsError(false)
    clearTimeout(saveTimerRef.current)
    try {
      await lastSavePromiseRef.current.catch(() => {})
      const revision = Math.max(revisionRef.current, savedRevisionRef.current) + 1
      revisionRef.current = revision
      setAnswerRevision(revision)
      const result = await window.examGuard.submitExam({
        answers: answersToList(questions, answersRef.current),
        clientRevision: revision,
      })
      setFinalState(result.status, result.submittedAt)
      setMessage('UniCORE confirmed your exam submission.')
    } catch (error) {
      setSubmissionUncertain(true)
      setMessage('Submission was not confirmed. Checking with UniCORE before allowing another attempt.')
      setIsError(true)
      if (error.message?.includes('session expired')) setStage('session-expired')
      try {
        const status = await reconcileSession()
        if (finalStatuses.has(status.status)) {
          setMessage('UniCORE confirmed that your exam was submitted.')
          setIsError(false)
        } else if (status.status === 'in-progress') {
          setSubmissionUncertain(false)
          setMessage(error.message || 'UniCORE still reports this attempt in progress. You may review and submit again.')
        }
      } catch {
        setMessage('Submission may have reached UniCORE, but its status is still unknown. Check the server status before trying again.')
      }
    } finally {
      submitLockRef.current = false
      setIsBusy(false)
    }
  }

  const checkDeadline = useCallback(async () => {
    if (deadlineCheckRef.current || stage !== 'exam') return
    deadlineCheckRef.current = true
    setDeadlineLocked(true)
    setMessage('Checking the server deadline…')
    setIsError(false)
    try {
      const status = await window.examGuard.getSessionStatus()
      if (finalStatuses.has(status.status)) {
        setFinalState(status.status, status.submittedAt)
        setMessage('The server deadline was reached. UniCORE finalized the saved answers.')
        return
      }
      const serverTime = Date.parse(status.serverTime)
      const offset = Number.isFinite(serverTime) ? serverTime - Date.now() : serverOffsetMs
      setServerOffsetMs(offset)
      const remaining = secondsRemaining(session?.exam.sessionEndsAt, offset)
      setRemainingSeconds(remaining)
      if (status.status === 'in-progress' && remaining > 0) {
        setDeadlineLocked(false)
        setMessage('')
      } else {
        setDeadlineCheckFailed(true)
        setMessage('The server has not confirmed the final session state. Answers remain locked; check status again.')
        setIsError(true)
      }
    } catch (error) {
      setDeadlineCheckFailed(true)
      setMessage(error.message || 'The deadline state could not be confirmed. Answers remain locked.')
      setIsError(true)
      if (error.message?.includes('session expired')) setStage('session-expired')
    } finally {
      deadlineCheckRef.current = false
    }
  }, [serverOffsetMs, session, setFinalState, stage])

  useEffect(() => {
    if (stage !== 'exam' || !session?.exam.sessionEndsAt || deadlineLocked) return undefined
    const tick = () => {
      const remaining = secondsRemaining(session.exam.sessionEndsAt, serverOffsetMs)
      setRemainingSeconds(remaining)
      if (remaining <= 0) void checkDeadline()
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [checkDeadline, deadlineLocked, serverOffsetMs, session, stage])

  const handleLogout = async () => {
    if (stage === 'exam') return
    setIsBusy(true)
    setIsError(false)
    try {
      const result = await window.examGuard.logout()
      setUser(null)
      setExam(null)
      setSession(null)
      setStage('connect')
      setMessage(result.message || 'Signed out.')
      setIsError(!result.ok)
    } catch (error) {
      setMessage(error.message || 'Unable to sign out.')
      setIsError(true)
    } finally {
      setIsBusy(false)
    }
  }

  const isLocked = stage !== 'exam' || deadlineLocked || submissionUncertain || isBusy
  const currentAnswer = activeQuestion ? answers[activeQuestion.id]?.answer : undefined
  const currentAnswerText = activeQuestion
    ? getAnswerText(currentAnswer, getStarterCode(activeQuestion))
    : ''
  const recordClipboardRestriction = (event, restricted, action) => {
    if (!restricted) return
    event.preventDefault()
    void window.examGuard.reportSecurityViolation(action).then((result) => {
      setSecurityMessage(result.recorded
        ? 'Exam security event recorded by UniCORE.'
        : 'This exam is configured not to record individual security events.')
    }).catch((error) => {
      setSecurityMessage(error.message || 'UniCORE could not record the clipboard restriction.')
    })
  }

  return (
    <main className="app-shell">
      <section className="exam-form" aria-labelledby="app-title">
        <div className="brand" aria-label="ExamGuard">
          <img className="brand__icon" src={examGuardIcon} alt="" />
          <span>ExamGuard</span>
        </div>

        {stage === 'exam' && session && activeQuestion ? (
          <div
            className="workspace"
            aria-label="Exam workspace"
            onCopyCapture={(event) => recordClipboardRestriction(
              event,
              exam?.security?.disableCopy,
              'copy_blocked',
            )}
            onCutCapture={(event) => recordClipboardRestriction(
              event,
              exam?.security?.disableCopy,
              'copy_blocked',
            )}
            onPasteCapture={(event) => recordClipboardRestriction(
              event,
              exam?.security?.disablePaste,
              'paste_blocked',
            )}
          >
            <ExamGuardCameraMonitor
              cameraRequired={exam?.security?.cameraRequired === true}
              microphoneRequired={exam?.security?.microphoneRequired === true}
            />
            <header className="workspace-header">
              <div className="session-header-meta" aria-label="Secure session status">
                <span className="integrity-dot" aria-hidden="true" />
                <span>Secure exam session</span>
              </div>
              <h1 id="app-title">{exam?.title}</h1>
              <p className="workspace-countdown" aria-live="polite">
                Time remaining: {formatRemainingTime(remainingSeconds)}
              </p>
              <p className="workspace-progress">
                Answered {answeredCount} of {questions.length} questions
              </p>
              <p className="save-status" role="status" aria-live="polite">
                {saveStatus === 'saving' && 'Saving answers…'}
                {saveStatus === 'saved' && 'All changes saved'}
                {saveStatus === 'dirty' && 'Changes waiting to save'}
                {saveStatus === 'failed' && 'Save failed — answers are not confirmed'}
              </p>
            </header>

            <nav className="question-list" aria-label="Question navigation">
              {questions.map((question, index) => {
                const answered = isQuestionAnswered(answers[question.id])
                return (
                  <button
                    key={question.id}
                    className={`question-number${index === questionIndex ? ' is-current' : ''}${answered ? ' is-answered' : ''}`}
                    type="button"
                    disabled={isLocked}
                    aria-current={index === questionIndex ? 'step' : undefined}
                    aria-label={`Question ${index + 1}${answered ? ', answered' : ', unanswered'}`}
                    onClick={() => setQuestionIndex(index)}
                  >
                    {index + 1}
                  </button>
                )
              })}
            </nav>

            <p className="unanswered-list">
              {unansweredNumbers.length
                ? `Unanswered: ${unansweredNumbers.join(', ')}`
                : 'Every question has a response.'}
            </p>

            <article className="question-panel">
              <div className="question-heading">
                <h2>
                  <span>{questionIndex + 1}. </span>
                  {activeQuestion.question}
                </h2>
                {activeQuestion.marks !== null && <span>{activeQuestion.marks} marks</span>}
              </div>

              {activeQuestion.hasImage && (
                activeQuestion.image
                  ? <img className="question-attachment" src={activeQuestion.image} alt="Question attachment" />
                  : <p className="attachment-note">The question attachment could not be loaded.</p>
              )}
              {activeQuestion.environment && (
                <p className="question-environment">Environment: {activeQuestion.environment}</p>
              )}
              {(activeQuestion.designResources?.length > 0 ||
                activeQuestion.designColors?.length > 0 ||
                activeQuestion.designTemplates?.length > 0) && (
                <aside className="question-materials" aria-label="Question materials">
                  <strong>Question materials</strong>
                  {activeQuestion.designResources?.length > 0 && (
                    <p>Resources: {activeQuestion.designResources.join(', ')}</p>
                  )}
                  {activeQuestion.designColors?.length > 0 && (
                    <p>Colors: {activeQuestion.designColors.join(', ')}</p>
                  )}
                  {activeQuestion.designTemplates?.length > 0 && (
                    <p>Templates: {activeQuestion.designTemplates.join(', ')}</p>
                  )}
                </aside>
              )}
              {activeQuestion.sqlSchema && (
                <details className="question-schema">
                  <summary>SQL starting schema</summary>
                  <pre>{activeQuestion.sqlSchema}</pre>
                </details>
              )}
              {activeQuestion.hints?.length > 0 && (
                <aside className="question-hints" aria-label="Question hints">
                  <strong>Hints</strong>
                  <ul>{activeQuestion.hints.map((hint, index) => <li key={`${index}-${hint}`}>{hint}</li>)}</ul>
                </aside>
              )}

              {activeQuestion.type === 'mcq' && (
                <fieldset className="answer-options" disabled={isLocked}>
                  <legend>Select one answer</legend>
                  {activeQuestion.options.map((option, index) => (
                    <label className="answer-option" key={`${activeQuestion.id}-${index}`}>
                      <input
                        type="radio"
                        name={`question-${activeQuestion.id}`}
                        value={option}
                        checked={currentAnswer === option}
                        onChange={() => updateAnswer(activeQuestion, option)}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </fieldset>
              )}

              {activeQuestion.type === 'truefalse' && (
                <fieldset className="answer-options" disabled={isLocked}>
                  <legend>Select True or False</legend>
                  {[true, false].map((value) => (
                    <label className="answer-option" key={String(value)}>
                      <input
                        type="radio"
                        name={`question-${activeQuestion.id}`}
                        checked={currentAnswer === value}
                        onChange={() => updateAnswer(activeQuestion, value)}
                      />
                      <span>{value ? 'True' : 'False'}</span>
                    </label>
                  ))}
                </fieldset>
              )}

              {activeQuestion.type === 'essay' && (
                <label className="response-field">
                  <span>Your answer</span>
                  <textarea
                    value={typeof currentAnswer === 'string' ? currentAnswer : ''}
                    disabled={isLocked}
                    onChange={(event) => updateAnswer(activeQuestion, event.target.value)}
                    rows={9}
                  />
                  {activeQuestion.wordLimit && (
                    <span>Word limit: {activeQuestion.wordLimit}</span>
                  )}
                </label>
              )}

              {activeQuestion.type === 'lab' && (
                <div style={{ minHeight: 460, height: 560, border: '1px solid #30363d', borderRadius: 12, overflow: 'hidden', background: '#0d1117' }}>
                  <StudentCodingLab
                    question={activeQuestion}
                    value={answers[activeQuestion.id]?.answer}
                    onSave={(value) => {
                      const payload = value && typeof value === 'object' ? value : { langId: selectedCodeLanguage, code: value }
                      updateAnswer(activeQuestion, payload)
                    }}
                  />
                </div>
              )}

              {activeQuestion.type === 'os_linux' && (
                <div style={{ minHeight: 460, height: 560, border: '1px solid #30363d', borderRadius: 12, overflow: 'hidden', background: '#0d1117' }}>
                  <LinuxLab
                    question={activeQuestion}
                    examId={exam?.id || questions[0]?.examId}
                    initialSessionId={
                      answers[activeQuestion.id]?.answer?.sessionId ||
                      (typeof answers[activeQuestion.id]?.answer === 'string' ? answers[activeQuestion.id]?.answer : null)
                    }
                    onSessionReady={(sessionId) => {
                      const currentAnswer = answers[activeQuestion.id]?.answer
                      updateAnswer(activeQuestion, {
                        ...(currentAnswer && typeof currentAnswer === 'object' ? currentAnswer : {}),
                        sessionId,
                      })
                    }}
                  />
                </div>
              )}

              {activeQuestion.type === 'design_lab' && (
                <div className="design-lab-host" style={{ minHeight: 720, height: 760, border: '1px solid #d4d4d8', borderRadius: 12, overflow: 'hidden', background: '#F3F4F7' }}>
                  <DesignLab
                    question={activeQuestion}
                    value={answers[activeQuestion.id]?.answer}
                    initialDesignId={
                      answers[activeQuestion.id]?.answer?.designId ||
                      (typeof answers[activeQuestion.id]?.answer === 'string' ? answers[activeQuestion.id]?.answer : null)
                    }
                    onDesignCreated={(designId) => {
                      const currentAnswer = answers[activeQuestion.id]?.answer
                      updateAnswer(activeQuestion, {
                        ...(currentAnswer && typeof currentAnswer === 'object' ? currentAnswer : {}),
                        designId,
                      })
                    }}
                    onChange={(value) => {
                      if (!value || typeof value === 'string') {
                        updateAnswer(activeQuestion, value || '')
                        return
                      }
                      const currentAnswer = answers[activeQuestion.id]?.answer
                      updateAnswer(activeQuestion, {
                        ...(currentAnswer && typeof currentAnswer === 'object' ? currentAnswer : {}),
                        ...value,
                      })
                    }}
                  />
                </div>
              )}

              {['os_windows', 'networking_lab'].includes(activeQuestion.type) && (
                <label className="response-field">
                  <span>Your written response</span>
                  <textarea
                    value={currentAnswerText}
                    disabled={isLocked}
                    onChange={(event) => updateAnswer(activeQuestion, parseAnswerText(event.target.value))}
                    rows={9}
                  />
                  <span>{activeQuestion.type === 'networking_lab'
                    ? 'Networking simulation is not available in this desktop session; provide the requested written response.'
                    : 'Windows lab tools are unavailable in ExamGuard; provide the requested written response.'}</span>
                </label>
              )}
            </article>

            <div className="question-controls">
              <button
                type="button"
                disabled={isLocked || questionIndex === 0}
                onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}
              >
                Previous
              </button>
              <span>Question {questionIndex + 1} of {questions.length}</span>
              <button
                type="button"
                disabled={isLocked || questionIndex === questions.length - 1}
                onClick={() => setQuestionIndex((index) => Math.min(questions.length - 1, index + 1))}
              >
                Next
              </button>
            </div>

            <div className="submit-row">
              {saveStatus === 'failed' && (
                <button type="button" disabled={isBusy || deadlineLocked} onClick={retrySave}>
                  Retry save
                </button>
              )}
              {submissionUncertain ? (
                <button type="button" disabled={isBusy} onClick={checkSubmissionStatus}>
                  Check submission status
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isBusy || deadlineLocked}
                  onClick={() => setSubmitConfirmation(true)}
                >
                  Submit exam
                </button>
              )}
              {deadlineCheckFailed && (
                <button type="button" disabled={isBusy} onClick={checkDeadline}>
                  Check deadline status
                </button>
              )}
            </div>

            {submitConfirmation && (
              <div className="confirmation-backdrop">
                <section
                  className="confirmation-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="submit-title"
                  aria-describedby="submit-description"
                >
                  <h2 id="submit-title">Submit this exam?</h2>
                  <p id="submit-description">
                    UniCORE will accept the submission once. You cannot change answers afterward.
                    {unansweredNumbers.length > 0 && ` Unanswered questions: ${unansweredNumbers.join(', ')}.`}
                  </p>
                  <div className="question-controls">
                    <button type="button" onClick={() => setSubmitConfirmation(false)}>Continue exam</button>
                    <button type="button" onClick={confirmSubmit}>Confirm submission</button>
                  </div>
                </section>
              </div>
            )}
          </div>
        ) : (
          <>
            <h1 id="app-title">
              {stage === 'submitted'
                ? 'Exam submitted'
                : stage === 'ready'
                  ? 'Exam ready'
                  : stage === 'checking'
                    ? 'Checking session'
                      : stage === 'session-expired'
                        ? 'Reconnect to UniCORE'
                      : 'Connect to UniCORE'}
            </h1>

            {user && <p className="session-user">Signed in as {user.fullName || user.name || user.email}</p>}
            {exam && <p className="session-exam">{exam.title}</p>}

            {stage === 'ready' && (
              <>
                {exam?.timeLimit && <p className="session-exam">Time limit: {exam.timeLimit} minutes</p>}
                {exam?.instructions && <p className="session-instructions">{exam.instructions}</p>}
                {exam?.security?.cameraRequired && (
                  <p className="camera-notice">
                    This exam requires camera monitoring. ExamGuard will show your camera preview and send periodic snapshots to UniCORE for instructor review.
                  </p>
                )}
                {exam?.security?.microphoneRequired && (
                  <p className="camera-notice">
                    This exam requires microphone monitoring. ExamGuard reports device status only; it does not record or transmit audio.
                  </p>
                )}
                <button className="primary-button" type="button" disabled={isBusy} onClick={startExam}>
                  {isBusy ? 'Please wait…' : 'Start exam'}
                </button>
              </>
            )}

            {stage === 'submitted' && (
              <div className="final-state" role="status">
                <p>UniCORE confirmed this attempt is final. Answers can no longer be changed.</p>
                {submittedAt && <p>Submitted: {new Date(submittedAt).toLocaleString()}</p>}
                {finalStatus === 'manual-review' && <p>Your responses are awaiting instructor review.</p>}
              </div>
            )}

            {(stage === 'connect' || stage === 'session-expired') && (
              <>
              <section className="launch-guidance" aria-labelledby="launch-guidance-heading">
                <h2 id="launch-guidance-heading">Open your exam from UniCORE</h2>
                <p>Sign in to the student portal, open an eligible exam, and choose <strong>Open UniCORE Exam App</strong>. Each launch ticket is one-time and expires quickly.</p>
                <button className="secondary-button" type="button" disabled={isBusy} onClick={openUniCorePortal}>
                  Return to the UniCORE portal
                </button>
              </section>
              <form className="ticket-form" onSubmit={handleRedeem} noValidate>
                <label htmlFor="launch-ticket">Enter the one-time ticket from the UniCORE portal</label>
                <input
                  id="launch-ticket"
                  name="launchTicket"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  placeholder="Paste launch ticket"
                  maxLength={43}
                  value={ticket}
                  disabled={isBusy}
                  aria-describedby="form-message"
                  aria-invalid={isError}
                  onChange={(event) => {
                    setTicket(event.target.value.trim())
                    setMessage('')
                    setIsError(false)
                  }}
                />
                <button className="primary-button" type="submit" disabled={isBusy || !ticket.trim()}>
                  {isBusy ? 'Verifying invitation…' : 'Verify Invitation'}
                </button>
              </form>
              </>
            )}

            {stage === 'unavailable' && (
              <p>The server reports that this exam is unavailable. No further answers can be saved.</p>
            )}

            <p className={`form-message${isError ? ' is-error' : ''}`} id="form-message" aria-live="polite" role={isError ? 'alert' : 'status'}>
              {message}
            </p>
            {securityMessage && (
              <p className="security-message" role="status" aria-live="polite">
                {securityMessage}
              </p>
            )}
            {user && stage !== 'exam' && (
              <button className="secondary-button" type="button" disabled={isBusy} onClick={handleLogout}>
                Sign out
              </button>
            )}
          </>
        )}
      </section>
    </main>
  )
}

export default App
