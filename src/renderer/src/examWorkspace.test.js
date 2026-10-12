import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  answersToList,
  answersToMap,
  createAutosaveQueue,
  formatRemainingTime,
  isQuestionAnswered,
  secondsRemaining,
} from './examWorkspace.js'

const questions = [
  { id: 'q1', type: 'mcq' },
  { id: 'q2', type: 'essay' },
]

test('hydrates only answers matching the server question IDs and types', () => {
  const answers = answersToMap(questions, [
    { questionId: 'q1', type: 'mcq', answer: 'option-a', privateNotes: 'ignore' },
    { questionId: 'q2', type: 'mcq', answer: 'wrong-type' },
    { questionId: 'other', type: 'essay', answer: 'unknown question' },
  ])
  assert.deepEqual(answers, {
    q1: { questionId: 'q1', type: 'mcq', answer: 'option-a', codeOutput: '' },
  })
  assert.deepEqual(answersToList(questions, answers), [
    { questionId: 'q1', type: 'mcq', answer: 'option-a', codeOutput: '' },
  ])
})

test('detects unanswered values and formats the deadline countdown', () => {
  assert.equal(isQuestionAnswered(undefined), false)
  assert.equal(isQuestionAnswered({ answer: '  ' }), false)
  assert.equal(isQuestionAnswered({ answer: false }), true)
  assert.equal(isQuestionAnswered({ answer: ['a'] }), true)
  assert.equal(formatRemainingTime(3661), '1:01:01')
  assert.equal(formatRemainingTime(61), '01:01')
  assert.equal(secondsRemaining('2026-01-01T00:01:00.000Z', 0, Date.parse('2026-01-01T00:00:00.000Z')), 60)
})

test('serializes autosaves so older snapshots cannot be sent after newer ones', async () => {
  const started = []
  const completions = []
  const enqueue = createAutosaveQueue((payload) => {
    started.push(payload.clientRevision)
    return new Promise((resolve) => completions.push(resolve))
  })
  const first = enqueue({ clientRevision: 1 })
  const second = enqueue({ clientRevision: 2 })
  await Promise.resolve()
  assert.deepEqual(started, [1])
  completions[0]()
  await first
  await Promise.resolve()
  assert.deepEqual(started, [1, 2])
  completions[1]()
  await second
})
