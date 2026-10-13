import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  answersToList,
  answersToMap,
  buildCodeExecutionRequest,
  createAutosaveQueue,
  formatRemainingTime,
  getExamGuardLabMode,
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

test('builds the secure code execution payload for exam lab questions and keeps the legacy fallback detection explicit', () => {
  const request = buildCodeExecutionRequest({
    questionId: 'q-lab-1',
    language: 'python',
    code: 'print(42)',
    stdin: 'hello',
  })
  assert.deepEqual(request, {
    questionId: 'q-lab-1',
    language: 'python',
    code: 'print(42)',
    stdin: 'hello',
  })
  assert.equal(getExamGuardLabMode(), 'legacy')
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

test('preserves object-based lab answers across the real exam question types', () => {
  const questions = [
    { id: 'coding-1', type: 'lab' },
    { id: 'design-1', type: 'design_lab' },
    { id: 'linux-1', type: 'os_linux' },
    { id: 'mcq-1', type: 'mcq' },
  ]

  const savedAnswers = [
    {
      questionId: 'coding-1',
      type: 'lab',
      answer: { langId: 'python', code: 'print("hi")', codes: { python: 'print("hi")' } },
      codeOutput: 'hi\n',
    },
    {
      questionId: 'design-1',
      type: 'design_lab',
      answer: { designId: 'design-42', canvas: { v: 1 } },
      codeOutput: '',
    },
    {
      questionId: 'linux-1',
      type: 'os_linux',
      answer: { sessionId: 'session-99' },
      codeOutput: '',
    },
    {
      questionId: 'mcq-1',
      type: 'mcq',
      answer: 'B',
      codeOutput: '',
    },
  ]

  const map = answersToMap(questions, savedAnswers)
  assert.deepEqual(map['coding-1'].answer, savedAnswers[0].answer)
  assert.deepEqual(map['design-1'].answer, savedAnswers[1].answer)
  assert.deepEqual(map['linux-1'].answer, savedAnswers[2].answer)
  assert.deepEqual(answersToList(questions, map), savedAnswers)
  assert.equal(isQuestionAnswered(map['coding-1']), true)
  assert.equal(isQuestionAnswered(map['design-1']), true)
  assert.equal(isQuestionAnswered(map['linux-1']), true)
})
