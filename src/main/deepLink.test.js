import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createExamGuardDeepLinkHandler,
  findExamGuardLaunchUrl,
  parseExamGuardLaunchUrl,
  registerExamGuardProtocolEvents,
} from './deepLink.js'

const ticket = 'a'.repeat(43)

test('parses only a well-formed ExamGuard launch URL', () => {
  assert.equal(parseExamGuardLaunchUrl(`examguard://launch?ticket=${ticket}`), ticket)
  assert.equal(parseExamGuardLaunchUrl('https://unicore.tech/examguard'), null)
  for (const value of [
    'examguard://other?ticket=' + ticket,
    `examguard://launch:1234?ticket=${ticket}`,
    'examguard://launch/path?ticket=' + ticket,
    'examguard://launch?ticket=short',
    `examguard://launch?ticket=${ticket}&studentId=attacker`,
    `examguard://launch?ticket=${ticket}&ticket=${ticket}`,
    `examguard://launch?ticket=${ticket}#fragment`,
  ]) {
    assert.throws(() => parseExamGuardLaunchUrl(value), /launch link is invalid/)
  }
})

test('finds startup launch links without interpreting other command-line arguments', () => {
  const url = `examguard://launch?ticket=${ticket}`
  assert.equal(findExamGuardLaunchUrl(['--no-sandbox', url]), url)
  assert.equal(findExamGuardLaunchUrl(['--no-sandbox']), null)
})

test('redeems in the main process and stores only the bound exam session', async () => {
  const calls = []
  const messages = []
  const saved = []
  const handler = createExamGuardDeepLinkHandler({
    launchApi: {
      redeemLaunchTicket: async (value) => {
        calls.push(value)
        return {
          user: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'student' },
          exam: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Midterm' },
        }
      },
    },
    examSessionStore: { set: (value) => saved.push(value) },
    getWindow: () => ({ webContents: { send: (...message) => messages.push(message) } }),
  })

  assert.equal(await handler(`examguard://launch?ticket=${ticket}`), true)
  assert.deepEqual(calls, [ticket])
  assert.deepEqual(saved, [{
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    exam: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Midterm' },
  }])
  assert.deepEqual(messages, [['examguard:deep-link-status', { status: 'redeemed' }]])
  assert.equal(JSON.stringify(messages).includes(ticket), false)
})

test('reports invalid and expired/redeemed tickets without saving a session', async () => {
  const messages = []
  let saves = 0
  const handler = createExamGuardDeepLinkHandler({
    launchApi: { redeemLaunchTicket: async () => { throw new Error('This launch ticket is invalid or expired.') } },
    examSessionStore: { set: () => { saves += 1 } },
    getWindow: () => ({ webContents: { send: (...message) => messages.push(message) } }),
  })

  assert.equal(await handler('examguard://bad'), false)
  assert.equal(await handler(`examguard://launch?ticket=${ticket}`), false)
  assert.equal(saves, 0)
  assert.deepEqual(messages.map(([, status]) => status.status), ['error', 'error'])
})

test('coalesces duplicate protocol events while ticket redemption is pending', async () => {
  let finishRedemption
  let redemptionCount = 0
  const handler = createExamGuardDeepLinkHandler({
    launchApi: {
      redeemLaunchTicket: () => {
        redemptionCount += 1
        return new Promise((resolve) => {
          finishRedemption = () => resolve({
            user: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
            exam: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Midterm' },
          })
        })
      },
    },
    examSessionStore: { set: () => {} },
    getWindow: () => ({ webContents: { send: () => {} } }),
  })
  const url = `examguard://launch?ticket=${ticket}`
  const first = handler(url)
  const second = handler(url)
  assert.equal(redemptionCount, 1)
  finishRedemption()
  assert.deepEqual(await Promise.all([first, second]), [true, true])
})

test('routes links from app startup and an already-running app instance', () => {
  const listeners = new Map()
  const handled = []
  let focused = 0
  registerExamGuardProtocolEvents({
    on: (name, callback) => listeners.set(name, callback),
  }, {
    handleLaunchUrl: (url) => handled.push(url),
    focusWindow: () => { focused += 1 },
  })

  const url = `examguard://launch?ticket=${ticket}`
  let prevented = false
  listeners.get('open-url')({ preventDefault: () => { prevented = true } }, url)
  listeners.get('second-instance')({}, ['examguard.exe', url])
  assert.equal(prevented, true)
  assert.equal(focused, 1)
  assert.deepEqual(handled, [url, url])
})
