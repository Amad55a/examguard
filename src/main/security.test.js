import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  createSecureWebPreferences,
  canRequestExamMedia,
  denyNewWindow,
  getDevelopmentRendererUrl,
  getPackagedConfigPath,
  isAllowedRendererNavigation,
  loadPublicConfig,
  validateApiBaseUrl,
} from './security.js'

test('web preferences keep renderer privileges isolated and sandboxed', () => {
  assert.deepEqual(createSecureWebPreferences('/app/preload.cjs'), {
    preload: '/app/preload.cjs',
    devTools: false,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  })
  assert.equal(createSecureWebPreferences('/app/preload.cjs', undefined, true).devTools, true)
})

test('permits only the exact required media devices from the trusted exam window', () => {
  const request = {
    permission: 'media',
    mediaTypes: ['video'],
    isMainFrame: true,
    isTrustedWindow: true,
    cameraRequired: true,
    microphoneRequired: false,
  }
  assert.equal(canRequestExamMedia(request), true)
  assert.equal(canRequestExamMedia({ ...request, mediaTypes: ['audio'] }), false)
  assert.equal(canRequestExamMedia({ ...request, mediaTypes: ['video', 'audio'] }), false)
  assert.equal(canRequestExamMedia({ ...request, isMainFrame: false }), false)
  assert.equal(canRequestExamMedia({ ...request, isTrustedWindow: false }), false)
  assert.equal(canRequestExamMedia({ ...request, cameraRequired: false }), false)
  assert.equal(canRequestExamMedia({ ...request, microphoneRequired: true }), false)
  assert.equal(canRequestExamMedia({
    ...request,
    mediaTypes: ['audio'],
    cameraRequired: false,
    microphoneRequired: true,
  }), true)
  assert.equal(canRequestExamMedia({
    ...request,
    mediaTypes: ['audio', 'video'],
    microphoneRequired: true,
  }), true)
})

test('development renderer URL accepts only loopback HTTP', () => {
  assert.equal(
    getDevelopmentRendererUrl('http://localhost:5173/', false),
    'http://localhost:5173/',
  )
  assert.equal(getDevelopmentRendererUrl('https://example.com', true), null)
  assert.throws(
    () => getDevelopmentRendererUrl('https://example.com', false),
    /loopback host/,
  )
  assert.throws(
    () => getDevelopmentRendererUrl('http://localhost.evil.test:5173', false),
    /loopback host/,
  )
  assert.throws(
    () => getDevelopmentRendererUrl('http://user@localhost:5173', false),
    /loopback host/,
  )
})

test('new windows are always denied', () => {
  assert.deepEqual(denyNewWindow(), { action: 'deny' })
})

test('navigation is limited to the current renderer origin or packaged entry file', () => {
  const devUrl = 'http://localhost:5173/'
  assert.equal(
    isAllowedRendererNavigation('http://localhost:5173/settings', devUrl, '', false),
    true,
  )
  assert.equal(
    isAllowedRendererNavigation('https://example.com', devUrl, '', false),
    false,
  )
  assert.equal(
    isAllowedRendererNavigation('http://user@localhost:5173/', devUrl, '', false),
    false,
  )
  assert.equal(
    isAllowedRendererNavigation(
      'file:///opt/examguard/out/renderer/index.html',
      '',
      '/opt/examguard/out/renderer/index.html',
      true,
    ),
    true,
  )
  assert.equal(
    isAllowedRendererNavigation(
      'file:///tmp/other.html',
      '',
      '/opt/examguard/out/renderer/index.html',
      true,
    ),
    false,
  )
})

test('API base URL config permits HTTPS in production and loopback HTTP in development', () => {
  assert.equal(
    validateApiBaseUrl('https://api.example.test/api/v1/', true),
    'https://api.example.test/api/v1',
  )
  assert.equal(
    validateApiBaseUrl('http://localhost:8080/api/v1', false),
    'http://localhost:8080/api/v1',
  )
  assert.throws(
    () => validateApiBaseUrl('http://example.test/api', true),
    /must be HTTPS/,
  )
  assert.throws(
    () => validateApiBaseUrl('https://user:password@example.test/api', true),
    /must be HTTPS/,
  )
})

test('public config rejects unrecognized keys and secrets-shaped URL credentials', () => {
  assert.deepEqual(
    loadPublicConfig(
      'config/development.json',
      false,
      (path) => readFileSync(path, 'utf8'),
    ),
    { apiBaseUrl: 'http://localhost:8080/api/v1' },
  )
  assert.deepEqual(
    loadPublicConfig(
      'config/production.json',
      true,
      (path) => readFileSync(path, 'utf8'),
    ),
    { apiBaseUrl: 'https://api.unicores.tech/api/v1' },
  )
  assert.throws(
    () =>
      loadPublicConfig('unused', true, () =>
        JSON.stringify({ apiBaseUrl: 'https://api.example.test', token: 'secret' }),
      ),
    /only apiBaseUrl/,
  )
})

test('packaged config path is resolved under Electron resources', () => {
  assert.equal(
    getPackagedConfigPath('/opt/ExamGuard/resources'),
    '/opt/ExamGuard/resources/config/production.json',
  )
  assert.throws(() => getPackagedConfigPath('relative/resources'), /must be absolute/)
})
