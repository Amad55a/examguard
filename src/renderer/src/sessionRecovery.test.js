import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSessionRecoveryMessage } from './sessionRecovery.js'

test('explains that an expired saved auth session needs a new portal launch', () => {
  assert.deepEqual(
    getSessionRecoveryMessage(new Error('Desktop session expired. Enter a new launch ticket.')),
    {
      kind: 'session-expired',
      message: 'Your saved UniCORE session has expired. Return to the portal and open the exam again to get a fresh launch ticket.',
    },
  )
})

test('distinguishes invalid, expired, and consumed tickets from authentication failures', () => {
  assert.equal(
    getSessionRecoveryMessage(new Error('This launch ticket is invalid or expired.')).kind,
    'ticket-invalid',
  )
  assert.equal(
    getSessionRecoveryMessage(Object.assign(new Error('Ticket rejected'), { status: 410 })).kind,
    'ticket-invalid',
  )
  assert.equal(
    getSessionRecoveryMessage(Object.assign(new Error('Unauthorized'), { status: 401 })).kind,
    'session-expired',
  )
})

test('provides distinct recovery instructions for network failures and eligibility', () => {
  assert.equal(
    getSessionRecoveryMessage(Object.assign(new Error('Network failed'), { retryable: true })).kind,
    'network',
  )
  assert.equal(
    getSessionRecoveryMessage(Object.assign(new Error('Unavailable'), { status: 403 })).kind,
    'ineligible',
  )
  assert.equal(getSessionRecoveryMessage(new Error('unexpected')).kind, 'unknown')
})
