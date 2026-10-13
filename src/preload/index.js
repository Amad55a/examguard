import { contextBridge, ipcRenderer } from 'electron'

let pendingDeepLinkStatus = null
ipcRenderer.on('examguard:deep-link-status', (_event, status) => {
  pendingDeepLinkStatus = status
})

contextBridge.exposeInMainWorld(
  'examGuard',
  Object.freeze({
    redeemLaunchTicket: (ticket) => ipcRenderer.invoke('examguard:redeem-launch-ticket', ticket),
    getCurrentUser: () => ipcRenderer.invoke('examguard:get-current-user'),
    openPortal: () => ipcRenderer.invoke('examguard:open-portal'),
    getExamSession: () => ipcRenderer.invoke('examguard:get-exam-session'),
    startExam: () => ipcRenderer.invoke('examguard:start-exam'),
    autosaveAnswers: (payload) => ipcRenderer.invoke('examguard:autosave-answers', payload),
    runCode: (payload) => ipcRenderer.invoke('examguard:run-code', payload),
    sendProctorHeartbeat: (payload) => ipcRenderer.invoke('examguard:proctor-heartbeat', payload),
    reportSecurityViolation: (action) => ipcRenderer.invoke('examguard:report-security-violation', action),
    onSecurityEvent: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, result) => callback(result)
      ipcRenderer.on('examguard:security-event', listener)
      return () => ipcRenderer.removeListener('examguard:security-event', listener)
    },
    submitExam: (payload) => ipcRenderer.invoke('examguard:submit-exam', payload),
    getSessionStatus: () => ipcRenderer.invoke('examguard:get-session-status'),
    logout: () => ipcRenderer.invoke('examguard:logout'),
    onDeepLinkStatus: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, status) => {
        pendingDeepLinkStatus = null
        callback(status)
      }
      ipcRenderer.on('examguard:deep-link-status', listener)
      return () => ipcRenderer.removeListener('examguard:deep-link-status', listener)
    },
    takePendingDeepLinkStatus: () => {
      const status = pendingDeepLinkStatus
      pendingDeepLinkStatus = null
      return status
    },
  }),
)
