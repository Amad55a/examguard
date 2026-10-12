import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function createSecureWebPreferences(preload, partition) {
  return {
    preload,
    ...(partition ? { partition } : {}),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  }
}

export function canRequestExamCamera({
  permission,
  mediaTypes,
  isMainFrame,
  isTrustedWindow,
  cameraRequired,
  microphoneRequired,
}) {
  return permission === 'media' &&
    isMainFrame === true &&
    isTrustedWindow === true &&
    cameraRequired === true &&
    microphoneRequired !== true &&
    Array.isArray(mediaTypes) &&
    mediaTypes.length === 1 &&
    mediaTypes[0] === 'video'
}

export function getDevelopmentRendererUrl(rendererUrl, isPackaged) {
  if (isPackaged || !rendererUrl) return null

  let parsedUrl
  try {
    parsedUrl = new URL(rendererUrl)
  } catch {
    throw new Error('ELECTRON_RENDERER_URL must be a local development URL')
  }

  if (
    parsedUrl.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(parsedUrl.hostname) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error('ELECTRON_RENDERER_URL must use HTTP on a loopback host')
  }

  return parsedUrl.href
}

export function denyNewWindow() {
  return { action: 'deny' }
}

export function isAllowedRendererNavigation(targetUrl, rendererUrl, rendererFile, isPackaged) {
  let target
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }

  if (isPackaged) {
    if (target.protocol !== 'file:' || target.search || target.username || target.password) {
      return false
    }
    try {
      return resolve(fileURLToPath(target)) === resolve(rendererFile)
    } catch {
      return false
    }
  }

  if (!rendererUrl || target.username || target.password) return false

  try {
    const appUrl = new URL(rendererUrl)
    return target.origin === appUrl.origin && target.protocol === 'http:'
  } catch {
    return false
  }
}

export function validateApiBaseUrl(value, isPackaged) {
  if (value === '') return ''
  if (typeof value !== 'string') {
    throw new Error('apiBaseUrl must be a string')
  }

  let apiUrl
  try {
    apiUrl = new URL(value)
  } catch {
    throw new Error('apiBaseUrl must be an absolute URL')
  }

  const isLocalDevelopmentUrl =
    !isPackaged &&
    apiUrl.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(apiUrl.hostname)

  if (
    (apiUrl.protocol !== 'https:' && !isLocalDevelopmentUrl) ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw new Error('apiBaseUrl must be HTTPS, or a loopback HTTP URL in development')
  }

  return apiUrl.href.replace(/\/$/, '')
}

export function loadPublicConfig(configPath, isPackaged, readFile) {
  let parsedConfig
  try {
    parsedConfig = JSON.parse(readFile(configPath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read ExamGuard public config: ${error.message}`)
  }

  if (
    !parsedConfig ||
    typeof parsedConfig !== 'object' ||
    Array.isArray(parsedConfig) ||
    Object.keys(parsedConfig).some((key) => key !== 'apiBaseUrl') ||
    !Object.hasOwn(parsedConfig, 'apiBaseUrl')
  ) {
    throw new Error('ExamGuard public config must contain only apiBaseUrl')
  }

  return Object.freeze({
    apiBaseUrl: validateApiBaseUrl(parsedConfig.apiBaseUrl, isPackaged),
  })
}

export function getPackagedConfigPath(resourcesPath) {
  if (!isAbsolute(resourcesPath)) {
    throw new Error('Electron resources path must be absolute')
  }
  return resolve(resourcesPath, 'config/production.json')
}
