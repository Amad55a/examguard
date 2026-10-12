import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createExamSessionStore } from './examSessionStore.js'

function createMemoryFileSystem() {
  const files = new Map()
  return {
    files,
    mkdirSync: () => {},
    readFileSync(path) {
      if (!files.has(path)) {
        const error = new Error('missing')
        error.code = 'ENOENT'
        throw error
      }
      return files.get(path)
    },
    writeFileSync(path, contents) {
      files.set(path, contents)
    },
    renameSync(from, to) {
      if (!files.has(from)) throw new Error('missing temporary file')
      files.set(to, files.get(from))
      files.delete(from)
    },
    unlinkSync(path) {
      if (!files.delete(path)) {
        const error = new Error('missing')
        error.code = 'ENOENT'
        throw error
      }
    },
  }
}

test('persists only the student and safe exam locator needed for recovery', () => {
  const fileSystem = createMemoryFileSystem()
  const store = createExamSessionStore('/user-data/active-exam.json', fileSystem)

  assert.equal(store.get(), null)
  store.set({
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    exam: {
      id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      title: 'Midterm',
      timeLimit: 30,
      availableUntil: '2030-01-01T00:00:00.000Z',
      sessionEndsAt: null,
    },
  })
  assert.deepEqual(store.get(), {
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    exam: {
      id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      title: 'Midterm',
      timeLimit: 30,
      availableUntil: '2030-01-01T00:00:00.000Z',
      sessionEndsAt: null,
    },
  })
  assert.equal(JSON.stringify([...fileSystem.files.values()]).includes('ticket'), false)
  assert.equal(JSON.stringify([...fileSystem.files.values()]).includes('token'), false)

  store.clear()
  assert.equal(store.get(), null)
})

test('rejects malformed saved records and does not accept token-shaped fields', () => {
  const fileSystem = createMemoryFileSystem()
  const store = createExamSessionStore('/user-data/active-exam.json', fileSystem)
  assert.throws(
    () => store.set({
      userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      token: 'secret',
      exam: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Midterm' },
    }),
    /saved ExamGuard session is invalid/,
  )
  fileSystem.files.set('/user-data/active-exam.json', '{')
  assert.throws(() => store.get(), /saved ExamGuard session is invalid/)
})

test('preserves student-facing exam instructions for safe session recovery', () => {
  const fileSystem = createMemoryFileSystem()
  const store = createExamSessionStore('/user-data/active-exam.json', fileSystem)
  store.set({
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    exam: {
      id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      title: 'Midterm',
      instructions: 'Submit all answers before leaving.',
    },
  })

  test('persists only approved camera policy flags with the exam locator', () => {
    const fileSystem = createMemoryFileSystem()
    const store = createExamSessionStore('/user-data/active-exam.json', fileSystem)
    store.set({
      userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      exam: {
        id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        title: 'Midterm',
        security: {
          cameraRequired: true,
          microphoneRequired: false,
          fullscreenRequired: true,
        },
      },
    })
    assert.deepEqual(store.get().exam.security, {
      cameraRequired: true,
      microphoneRequired: false,
      fullscreenRequired: true,
    })
    assert.throws(() => store.set({
      userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      exam: {
        id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        title: 'Midterm',
        security: { sebConfigKey: 'must-not-be-stored' },
      },
    }), /saved ExamGuard session is invalid/)
  })
  assert.equal(store.get().exam.instructions, 'Submit all answers before leaving.')
})
