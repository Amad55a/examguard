const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SUPPORTED_SCHEMES = new Set(['examguard', 'unicore-exam'])

export function registerExamGuardProtocolClients(app, { isPackaged, executablePath, appPath }) {
  const developmentArgs = !isPackaged && executablePath && appPath
    ? [executablePath, [appPath]]
    : []
  for (const scheme of SUPPORTED_SCHEMES) {
    app.setAsDefaultProtocolClient(scheme, ...developmentArgs)
  }
}

export function parseExamGuardLaunchUrl(value) {
  if (typeof value !== 'string' || !/^(examguard|unicore-exam):/i.test(value)) return null

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('The ExamGuard launch link is invalid.')
  }

  const tickets = parsed.searchParams.getAll('ticket')
  if (
    !SUPPORTED_SCHEMES.has(parsed.protocol.replace(':', '').toLowerCase()) ||
    parsed.hostname !== 'launch' ||
    parsed.port ||
    parsed.pathname !== '' ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    [...parsed.searchParams.keys()].some((key) => key !== 'ticket') ||
    tickets.length !== 1 ||
    !TICKET_PATTERN.test(tickets[0])
  ) {
    throw new Error('The ExamGuard launch link is invalid.')
  }

  return tickets[0]
}

export function findExamGuardLaunchUrl(args) {
  return Array.isArray(args)
    ? args.find((argument) => typeof argument === 'string' && /^(examguard|unicore-exam):/i.test(argument)) || null
    : null
}

export function registerExamGuardProtocolEvents(app, { handleLaunchUrl, focusWindow }) {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    void handleLaunchUrl(url)
  })
  app.on('second-instance', (_event, commandLine) => {
    focusWindow()
    const launchUrl = findExamGuardLaunchUrl(commandLine)
    if (launchUrl) void handleLaunchUrl(launchUrl)
  })
}

export function createExamGuardDeepLinkHandler({ launchApi, examSessionStore, getWindow }) {
  let activeTicket = null
  let activeRedemption = null

  return async function handleLaunchUrl(value) {
    let ticket
    try {
      ticket = parseExamGuardLaunchUrl(value)
      if (!ticket) return false
      if (activeTicket === ticket) return await activeRedemption

      activeTicket = ticket
      activeRedemption = (async () => {
        try {
          const result = await launchApi.redeemLaunchTicket(ticket)
          examSessionStore.set({ userId: result.user.id, exam: result.exam })
          getWindow()?.webContents.send('examguard:deep-link-status', { status: 'redeemed' })
          return true
        } catch (error) {
          getWindow()?.webContents.send('examguard:deep-link-status', {
            status: 'error',
            message: error instanceof Error ? error.message : 'Unable to redeem the ExamGuard launch ticket.',
          })
          return false
        } finally {
          activeTicket = null
          activeRedemption = null
          ticket = null
        }
      })()
      return await activeRedemption
    } catch (error) {
      getWindow()?.webContents.send('examguard:deep-link-status', {
        status: 'error',
        message: error instanceof Error ? error.message : 'The ExamGuard launch link is invalid.',
      })
      return false
    } finally {
      ticket = null
    }
  }
}
