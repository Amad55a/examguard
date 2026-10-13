export function setActiveExamWindowMode(window, { active, fullscreenRequired = false }) {
  window.setMinimizable(!active)
  window.setMaximizable(!active)
  window.setResizable(!active)
  window.setClosable(true)

  const useKiosk = active && fullscreenRequired
  window.setKiosk(useKiosk)
  window.setFullScreen(useKiosk)
}

function restoreExamPresentation(window) {
  if (window.isDestroyed?.()) return
  if (window.isMinimized?.()) window.restore()
  window.setKiosk(true)
  window.setFullScreen(true)
}

export function registerExamDisplayRestrictions(
  screen,
  { getWindow, getSecurity, schedule = setTimeout },
) {
  const restoreForDisplayChange = () => {
    schedule(() => {
      const window = getWindow()
      if (!window || !getSecurity()?.fullscreenRequired) return
      restoreExamPresentation(window)
    }, 0)
  }
  const events = ['display-added', 'display-removed', 'display-metrics-changed']
  for (const event of events) screen.on(event, restoreForDisplayChange)
  return () => {
    for (const event of events) screen.removeListener(event, restoreForDisplayChange)
  }
}

export function registerExamCloseGuard(window, { isExamActive, showExitWarning }) {
  window.on('close', (event) => {
    if (!isExamActive()) return
    event.preventDefault()
    showExitWarning()
  })
}

export function registerExamWindowRestrictions(window, {
  getSecurity,
  reportExamFault,
  reportSecurityViolation,
  devToolsDisabled,
  schedule = setTimeout,
}) {
  window.webContents.on('context-menu', (event) => {
    if (!getSecurity()?.disableRightClick) return
    event.preventDefault()
    reportSecurityViolation('right_click_blocked')
  })
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = String(input.key || '').toLowerCase()
    const command = input.control || input.meta
    const copyShortcut = (command && ['c', 'x', 'insert'].includes(key)) ||
      (input.shift && key === 'delete')
    const pasteShortcut = (command && key === 'v') || (input.shift && key === 'insert')
    const devtoolsShortcut = input.key === 'F12' ||
      (command && input.shift && ['i', 'j', 'c'].includes(key))
    const devToolsAreDisabled = typeof devToolsDisabled === 'function'
      ? devToolsDisabled()
      : devToolsDisabled
    const security = getSecurity()
    if (
      (copyShortcut && security?.disableCopy) ||
      (pasteShortcut && security?.disablePaste) ||
      (devToolsAreDisabled && devtoolsShortcut)
    ) {
      event.preventDefault()
      if (copyShortcut && security?.disableCopy) {
        reportSecurityViolation('copy_blocked')
      } else if (pasteShortcut && security?.disablePaste) {
        reportSecurityViolation('paste_blocked')
      } else if (devToolsAreDisabled && devtoolsShortcut && security) {
        reportSecurityViolation('devtools_suspected')
      }
    }
  })
  window.on('blur', () => {
    const security = getSecurity()
    if (security?.detectTabSwitch || security?.fullscreenRequired) {
      reportExamFault('window_blur')
    }
  })
  const restorePresentation = () => {
    if (!getSecurity()?.fullscreenRequired) return
    schedule(() => {
      if (!window.isDestroyed?.() && getSecurity()?.fullscreenRequired) {
        restoreExamPresentation(window)
      }
    }, 0)
  }
  window.on('focus', restorePresentation)
  window.on('restore', restorePresentation)
  window.on('resize', restorePresentation)
  window.on('maximize', restorePresentation)
  window.on('minimize', (event) => {
    if (!getSecurity()?.fullscreenRequired) return
    event.preventDefault()
    reportExamFault('minimize')
    window.restore()
    restoreExamPresentation(window)
  })
  window.on('leave-full-screen', () => {
    if (!getSecurity()?.fullscreenRequired) return
    reportExamFault('fullscreen_exit')
    restorePresentation()
  })
}
