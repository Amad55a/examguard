import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i

function validateRecord(record) {
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    !OBJECT_ID_PATTERN.test(record.userId || '') ||
    !record.exam ||
    typeof record.exam !== 'object' ||
    Array.isArray(record.exam) ||
    !OBJECT_ID_PATTERN.test(record.exam.id || '') ||
    typeof record.exam.title !== 'string' ||
    Object.keys(record).some((key) => !['userId', 'exam'].includes(key)) ||
    Object.keys(record.exam).some((key) => !['id', 'title', 'instructions', 'security', 'timeLimit', 'availableUntil', 'sessionEndsAt'].includes(key))
  ) {
    throw new Error('The saved ExamGuard session is invalid.')
  }
  if (
    record.exam.security !== undefined &&
    (
      !record.exam.security ||
      typeof record.exam.security !== 'object' ||
      Array.isArray(record.exam.security) ||
      Object.keys(record.exam.security).some((key) =>
        ![
          'cameraRequired',
          'microphoneRequired',
          'fullscreenRequired',
          'browserLock',
          'disableCopy',
          'disablePaste',
          'disableRightClick',
          'detectTabSwitch',
          'autoSubmit',
          'recordViolations',
        ].includes(key),
      ) ||
      Object.values(record.exam.security).some((value) => typeof value !== 'boolean')
    )
  ) {
    throw new Error('The saved ExamGuard session is invalid.')
  }
  return {
    userId: record.userId,
    exam: {
      id: record.exam.id,
      title: record.exam.title,
      timeLimit: Number.isFinite(record.exam.timeLimit) ? record.exam.timeLimit : null,
      availableUntil: typeof record.exam.availableUntil === 'string' ? record.exam.availableUntil : null,
      sessionEndsAt: typeof record.exam.sessionEndsAt === 'string' ? record.exam.sessionEndsAt : null,
      ...(typeof record.exam.instructions === 'string'
        ? { instructions: record.exam.instructions.slice(0, 10_000) }
        : {}),
      ...(record.exam.security
        ? { security: { ...record.exam.security } }
        : {}),
    },
  }
}

export function createExamSessionStore(filePath, fileSystem = {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
}) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
    throw new Error('ExamGuard session storage path must be absolute.')
  }
  const temporaryPath = `${filePath}.tmp`

  return Object.freeze({
    get() {
      let serialized
      try {
        serialized = fileSystem.readFileSync(filePath, 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw new Error('ExamGuard could not read its saved exam session.')
      }
      let parsed
      try {
        parsed = JSON.parse(serialized)
      } catch {
        throw new Error('The saved ExamGuard session is invalid.')
      }
      return validateRecord(parsed)
    },

    set(record) {
      const validRecord = validateRecord(record)
      fileSystem.mkdirSync(dirname(filePath), { recursive: true })
      fileSystem.writeFileSync(temporaryPath, JSON.stringify(validRecord), { mode: 0o600 })
      fileSystem.renameSync(temporaryPath, filePath)
    },

    clear() {
      try {
        fileSystem.unlinkSync(filePath)
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw new Error('ExamGuard could not clear its saved exam session.')
        }
      }
      try {
        fileSystem.unlinkSync(temporaryPath)
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw new Error('ExamGuard could not clear its temporary session file.')
        }
      }
    },
  })
}
