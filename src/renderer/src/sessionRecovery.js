export function getSessionRecoveryMessage(error) {
  const message = typeof error?.message === 'string' ? error.message : ''
  const normalized = message.toLowerCase()
  const status = error?.status

  if (
    status === 401 ||
    normalized.includes('desktop session expired') ||
    normalized.includes('exam session expired')
  ) {
    return {
      kind: 'session-expired',
      message: 'Your saved UniCORE session has expired. Return to the portal and open the exam again to get a fresh launch ticket.',
    }
  }

  if (
    status === 410 ||
    /launch ticket.{0,40}(invalid|expired|used|redeemed)/i.test(message)
  ) {
    return {
      kind: 'ticket-invalid',
      message: 'This launch ticket is invalid, expired, or already used. Return to the portal and open the exam again for a new ticket.',
    }
  }

  if (/enter the 43-character launch ticket/i.test(message)) {
    return {
      kind: 'ticket-malformed',
      message: 'Enter the complete 43-character launch ticket shown by the UniCORE portal.',
    }
  }

  if (
    error?.retryable === true ||
    /could not reach|could not connect|timed out|network is unavailable|hostname could not be resolved|certificate verification|temporarily unavailable/i.test(message)
  ) {
    return {
      kind: 'network',
      message: 'ExamGuard could not connect securely to UniCORE. Check your internet connection, then try again. If the problem continues, return to the portal later.',
    }
  }

  if (status === 403 || status === 428 || normalized.includes('unavailable for examguard')) {
    return {
      kind: 'ineligible',
      message: 'UniCORE reports that this exam is not available to launch in ExamGuard. Check your eligibility or contact your instructor.',
    }
  }

  return {
    kind: 'unknown',
    message: 'ExamGuard could not verify this exam session. Return to the UniCORE portal and launch the exam again.',
  }
}
