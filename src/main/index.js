import { app, BrowserWindow, Menu, ipcMain, session, shell, screen } from 'electron'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import {
  createSecureWebPreferences,
  canRequestExamMedia,
  denyNewWindow,
  getDevelopmentRendererUrl,
  getPackagedConfigPath,
  isAllowedRendererNavigation,
  loadPublicConfig,
} from './security.js'
import { createLaunchTicketApi } from './launchTicket.js'
import { registerLaunchTicketIpc } from './launchTicketIpc.js'
import { createExamSessionStore } from './examSessionStore.js'
import {
  registerExamCloseGuard,
  registerExamDisplayRestrictions,
  registerExamWindowRestrictions,
  setActiveExamWindowMode,
} from './windowMode.js'
import {
  createExamGuardDeepLinkHandler,
  findExamGuardLaunchUrl,
  registerExamGuardProtocolClients,
  registerExamGuardProtocolEvents,
} from './deepLink.js'

const AUTH_PARTITION = 'persist:examguard-auth'
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const rendererUrl = getDevelopmentRendererUrl(
  process.env.ELECTRON_RENDERER_URL,
  app.isPackaged,
)
const rendererFile = fileURLToPath(new URL('../renderer/index.html', import.meta.url))
const configPath = app.isPackaged
  ? getPackagedConfigPath(process.resourcesPath)
  : resolve(app.getAppPath(), 'config/development.json')
const publicConfig = loadPublicConfig(configPath, app.isPackaged, readFileSync)
let launchApi
let deepLinkHandler = null
let mainWindow = null
let activeExamSecurity = null
let activeExamId = null
let faultRequestInFlight = false
let lastFaultAt = 0
const lastViolationAt = new Map()
const queuedLaunchUrls = []

function focusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function dispatchLaunchUrl(url) {
  if (deepLinkHandler) {
    void deepLinkHandler(url)
  } else {
    queuedLaunchUrls.push(url)
  }
}

function sendSecurityEvent(result) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('examguard:security-event', result)
}

function reportSecurityViolation(action) {
  if (!launchApi || !activeExamId || !activeExamSecurity?.recordViolations) return
  const now = Date.now()
  if (now - (lastViolationAt.get(action) || 0) < 2_000) return
  lastViolationAt.set(action, now)
  void launchApi.reportSecurityViolation(activeExamId, action).then((result) => {
    sendSecurityEvent({ violation: action, recorded: result.recorded })
  }).catch(() => {
    sendSecurityEvent({ error: 'UniCORE could not record a security event. Check your connection.' })
  })
}

function recordExamFault(reason) {
  if (!launchApi || !activeExamId || !activeExamSecurity || faultRequestInFlight) return
  const now = Date.now()
  if (now - lastFaultAt < 2_500) return
  lastFaultAt = now
  faultRequestInFlight = true
  void launchApi.recordExamFault(activeExamId, reason).then((result) => {
    if (result.autoSubmitted) clearExamSecurity()
    sendSecurityEvent(result)
  }).catch(() => {
    sendSecurityEvent({ error: 'UniCORE could not confirm the exam security event. Check your connection.' })
  }).finally(() => {
    faultRequestInFlight = false
  })
}

function activateExamSecurity(security, examId) {
  activeExamSecurity = security || {}
  activeExamId = examId || null
  lastFaultAt = 0
  if (!mainWindow || mainWindow.isDestroyed()) return
  setActiveExamWindowMode(mainWindow, {
    active: true,
    fullscreenRequired: activeExamSecurity?.fullscreenRequired === true,
  })
}

function clearExamSecurity() {
  activeExamSecurity = null
  activeExamId = null
  if (mainWindow && !mainWindow.isDestroyed()) {
    setActiveExamWindowMode(mainWindow, { active: false })
  }
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  registerExamGuardProtocolClients(app, {
    isPackaged: app.isPackaged,
    executablePath: process.execPath,
    appPath: process.argv[1] ? resolve(process.argv[1]) : null,
  })
  registerExamGuardProtocolEvents(app, {
    handleLaunchUrl: dispatchLaunchUrl,
    focusWindow,
  })
}

function assertTrustedMainFrame(event) {
  if (
    event.senderFrame !== event.sender.mainFrame ||
    !isAllowedRendererNavigation(
      event.senderFrame.url,
      rendererUrl,
      rendererFile,
      app.isPackaged,
    )
  ) {
    throw new Error('ExamGuard operation is only available to its main window.')
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 320,
    minHeight: 560,
    backgroundColor: '#FFFFFF',
    show: false,
    autoHideMenuBar: true,
    webPreferences: createSecureWebPreferences(
      fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      AUTH_PARTITION,
      !app.isPackaged,
    ),
  })
  mainWindow = window

  Menu.setApplicationMenu(null)

  registerExamCloseGuard(window, {
    isExamActive: () => Boolean(activeExamSecurity),
    showExitWarning: () => sendSecurityEvent({ closeBlocked: true }),
  })

  window.webContents.setWindowOpenHandler(denyNewWindow)
  if (app.isPackaged) {
    window.webContents.on('devtools-opened', () => window.webContents.closeDevTools())
  }
  const blockUntrustedNavigation = (event, targetUrl) => {
    if (!isAllowedRendererNavigation(targetUrl, rendererUrl, rendererFile, app.isPackaged)) {
      event.preventDefault()
    }
  }
  window.webContents.on('will-navigate', blockUntrustedNavigation)
  window.webContents.on('will-redirect', blockUntrustedNavigation)
  registerExamWindowRestrictions(window, {
    getSecurity: () => activeExamSecurity,
    reportExamFault: recordExamFault,
    reportSecurityViolation,
    devToolsDisabled: () => app.isPackaged || Boolean(activeExamSecurity),
  })

  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(rendererFile)
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  registerExamDisplayRestrictions(screen, {
    getWindow: () => mainWindow,
    getSecurity: () => activeExamSecurity,
  })
  const authSession = session.fromPartition(AUTH_PARTITION)
  launchApi = createLaunchTicketApi({
    apiBaseUrl: publicConfig.apiBaseUrl,
    authSession,
  })
  const examSessionStore = createExamSessionStore(
    join(app.getPath('userData'), 'active-exam-session.json'),
  )
  authSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    let allowed = false
    try {
      const savedSession = examSessionStore.get()
      const requestingUrl = details.requestingUrl || webContents.getURL()
      const trustedOrigin = isAllowedRendererNavigation(
        requestingUrl,
        rendererUrl,
        rendererFile,
        app.isPackaged,
      )
      allowed = canRequestExamMedia({
        permission,
        mediaTypes: details.mediaTypes,
        isMainFrame: details.isMainFrame,
        isTrustedWindow: webContents === mainWindow?.webContents && trustedOrigin,
        cameraRequired: savedSession?.exam.security?.cameraRequired,
        microphoneRequired: savedSession?.exam.security?.microphoneRequired,
      })
    } catch {
      allowed = false
    }
    callback(allowed)
  })
  registerLaunchTicketIpc(ipcMain, launchApi, assertTrustedMainFrame, examSessionStore, {
    onExamStarted: activateExamSecurity,
    onExamEnded: clearExamSecurity,
    openPortal: () => shell.openExternal('https://www.unicores.tech/exam-portal'),
  })
  deepLinkHandler = createExamGuardDeepLinkHandler({
    launchApi,
    examSessionStore,
    getWindow: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return null
      return {
        webContents: {
          send: (channel, payload) => {
            const window = mainWindow
            if (!window || window.isDestroyed()) return
            const send = () => {
              if (!window.isDestroyed()) window.webContents.send(channel, payload)
            }
            if (window.webContents.isLoading()) {
              window.webContents.once('did-finish-load', send)
            } else {
              send()
            }
          },
        },
      }
    },
  })
  createWindow()
  const initialLaunchUrl = findExamGuardLaunchUrl(process.argv)
  if (initialLaunchUrl) dispatchLaunchUrl(initialLaunchUrl)
  for (const launchUrl of queuedLaunchUrls.splice(0)) dispatchLaunchUrl(launchUrl)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
