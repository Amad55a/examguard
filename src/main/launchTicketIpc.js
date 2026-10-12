export function registerLaunchTicketIpc(
  ipcMain,
  launchApi,
  assertTrustedMainFrame,
  examSessionStore,
  callbacks = {},
) {
  let authenticatedUserId = null

  async function requireActiveExam() {
    const savedSession = examSessionStore.get()
    if (!savedSession) throw new Error('Redeem a launch ticket before opening an exam.')
    if (!authenticatedUserId) {
      const { user } = await launchApi.getCurrentUser()
      authenticatedUserId = user.id
    }
    if (savedSession.userId !== authenticatedUserId) {
      examSessionStore.clear()
      throw new Error('The saved exam belongs to another signed-in student.')
    }
    return savedSession
  }

  ipcMain.handle('examguard:redeem-launch-ticket', async (event, ticket) => {
    assertTrustedMainFrame(event)
    const result = await launchApi.redeemLaunchTicket(ticket)
    examSessionStore.set({ userId: result.user.id, exam: result.exam })
    authenticatedUserId = result.user.id
    return result
  })

  ipcMain.handle('examguard:get-current-user', async (event) => {
    assertTrustedMainFrame(event)
    const result = await launchApi.getCurrentUser()
    authenticatedUserId = result.user.id
    const savedSession = examSessionStore.get()
    if (savedSession && savedSession.userId !== authenticatedUserId) {
      examSessionStore.clear()
    }
    return result
  })

  ipcMain.handle('examguard:get-exam-session', async (event) => {
    assertTrustedMainFrame(event)
    if (!examSessionStore.get()) return { status: 'none', exam: null }
    const savedSession = await requireActiveExam()
    if (savedSession.exam.security?.microphoneRequired || savedSession.exam.security?.browserLock) {
      throw new Error('This exam requires security features that ExamGuard does not support.')
    }
    const status = await launchApi.getExamSessionStatus(savedSession.exam.id)
    if (status.status === 'in-progress') {
      const session = await launchApi.startExam(savedSession.exam.id)
      callbacks.onExamStarted?.(session.exam.security, savedSession.exam.id)
      return { exam: savedSession.exam, status: status.status, session }
    }
    callbacks.onExamEnded?.()
    return {
      exam: savedSession.exam,
      status: status.status,
      sessionEndsAt: status.sessionEndsAt,
      submittedAt: status.submittedAt,
      serverTime: status.serverTime,
      answerRevision: status.answerRevision,
    }
  })

  ipcMain.handle('examguard:start-exam', async (event) => {
    assertTrustedMainFrame(event)
    const savedSession = await requireActiveExam()
    if (savedSession.exam.security?.microphoneRequired || savedSession.exam.security?.browserLock) {
      throw new Error('This exam requires security features that ExamGuard does not support.')
    }
    const startedSession = await launchApi.startExam(savedSession.exam.id)
    callbacks.onExamStarted?.(startedSession.exam.security, savedSession.exam.id)
    return startedSession
  })

  ipcMain.handle('examguard:autosave-answers', async (event, payload) => {
    assertTrustedMainFrame(event)
    const savedSession = await requireActiveExam()
    return launchApi.autosaveAnswers(savedSession.exam.id, payload)
  })

  ipcMain.handle('examguard:run-code', async (event, payload) => {
    assertTrustedMainFrame(event)
    const savedSession = await requireActiveExam()
    return launchApi.runCode(savedSession.exam.id, payload)
  })

  ipcMain.handle('examguard:report-security-violation', async (event, action) => {
    assertTrustedMainFrame(event)
    const savedSession = await requireActiveExam()
    const security = savedSession.exam.security || {}
    const enabled = action === 'copy_blocked' || action === 'clipboard_blocked'
      ? security.disableCopy === true || security.disablePaste === true
      : action === 'paste_blocked'
        ? security.disablePaste === true
        : action === 'right_click_blocked'
          ? security.disableRightClick === true
          : action === 'devtools_suspected'
      if (!enabled) throw new Error('This exam security event is not enabled.')
    return launchApi.reportSecurityViolation(savedSession.exam.id, action)
  })

  ipcMain.handle('examguard:proctor-heartbeat', async (event, payload) => {
    assertTrustedMainFrame(event)
    const savedSession = await requireActiveExam()
    if (
      savedSession.exam.security?.cameraRequired !== true ||
      savedSession.exam.security?.microphoneRequired === true
    ) {
      throw new Error('Camera monitoring is not enabled for this exam.')
    }
    return launchApi.sendProctorHeartbeat(savedSession.exam.id, payload)
  })

  ipcMain.handle('examguard:submit-exam', async (event, payload) => {
    assertTrustedMainFrame(event)
    const savedSession = await requireActiveExam()
    const result = await launchApi.submitExam(savedSession.exam.id, payload)
    callbacks.onExamEnded?.()
    return result
  })

  ipcMain.handle('examguard:get-session-status', async (event) => {
    assertTrustedMainFrame(event)
    const savedSession = await requireActiveExam()
    const status = await launchApi.getExamSessionStatus(savedSession.exam.id)
    if (['submitted', 'auto-graded', 'manual-review', 'graded', 'published'].includes(status.status)) {
      callbacks.onExamEnded?.()
    }
    return status
  })

  ipcMain.handle('examguard:logout', async (event) => {
    assertTrustedMainFrame(event)
    try {
      return await launchApi.logout()
    } finally {
      authenticatedUserId = null
      examSessionStore.clear()
      callbacks.onExamEnded?.()
    }
  })
}
