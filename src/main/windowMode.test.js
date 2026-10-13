import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import {
  registerExamCloseGuard,
  registerExamDisplayRestrictions,
  registerExamWindowRestrictions,
  setActiveExamWindowMode,
} from './windowMode.js'

function createWindow() {
  const calls = []
  const window = new EventEmitter()
  window.setMinimizable = (value) => calls.push(['minimizable', value])
  window.setMaximizable = (value) => calls.push(['maximizable', value])
  window.setResizable = (value) => calls.push(['resizable', value])
  window.setClosable = (value) => calls.push(['closable', value])
  window.setKiosk = (value) => calls.push(['kiosk', value])
  window.setFullScreen = (value) => calls.push(['fullscreen', value])
  return { window, calls }
}

test('exam mode enables kiosk/fullscreen and disables minimize and maximize controls', () => {
  const { window, calls } = createWindow()
  setActiveExamWindowMode(window, { active: true, fullscreenRequired: true })
  assert.deepEqual(calls, [
    ['minimizable', false],
    ['maximizable', false],
    ['resizable', false],
    ['closable', true],
    ['kiosk', true],
    ['fullscreen', true],
  ])
})

test('leaving exam mode restores normal window controls and fullscreen behavior', () => {
  const { window, calls } = createWindow()
  setActiveExamWindowMode(window, { active: true, fullscreenRequired: true })
  setActiveExamWindowMode(window, { active: false })
  assert.deepEqual(calls.slice(-6), [
    ['minimizable', true],
    ['maximizable', true],
    ['resizable', true],
    ['closable', true],
    ['kiosk', false],
    ['fullscreen', false],
  ])
})

test('an active attempt intercepts close and warns without affecting normal close', () => {
  const { window } = createWindow()
  let active = true
  let warnings = 0
  registerExamCloseGuard(window, {
    isExamActive: () => active,
    showExitWarning: () => { warnings += 1 },
  })

  let prevented = false
  window.emit('close', { preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(warnings, 1)

  active = false
  prevented = false
  window.emit('close', { preventDefault: () => { prevented = true } })
  assert.equal(prevented, false)
  assert.equal(warnings, 1)
})

test('configured context menu and clipboard restrictions are prevented and reported', () => {
  const { window } = createWindow()
  window.webContents = new EventEmitter()
  const violations = []
  const security = {
    disableRightClick: true,
    disableCopy: true,
    disablePaste: true,
  }
  registerExamWindowRestrictions(window, {
    getSecurity: () => security,
    reportExamFault: () => {},
    reportSecurityViolation: (action) => violations.push(action),
    devToolsDisabled: false,
  })

  const contextEvent = { preventDefault() { this.prevented = true } }
  window.webContents.emit('context-menu', contextEvent)
  const copyEvent = { preventDefault() { this.prevented = true } }
  window.webContents.emit('before-input-event', copyEvent, {
    type: 'keyDown',
    key: 'c',
    control: true,
  })
  const pasteEvent = { preventDefault() { this.prevented = true } }
  window.webContents.emit('before-input-event', pasteEvent, {
    type: 'keyDown',
    key: 'v',
    meta: true,
  })

  assert.equal(contextEvent.prevented, true)
  assert.equal(copyEvent.prevented, true)
  assert.equal(pasteEvent.prevented, true)
  assert.deepEqual(violations, ['right_click_blocked', 'copy_blocked', 'paste_blocked'])
})

test('focus loss, minimize, and fullscreen exit report configured faults and restore kiosk', () => {
  const { window, calls } = createWindow()
  window.webContents = new EventEmitter()
  const faults = []
  registerExamWindowRestrictions(window, {
    getSecurity: () => ({ detectTabSwitch: true, fullscreenRequired: true }),
    reportExamFault: (reason) => faults.push(reason),
    reportSecurityViolation: () => {},
    devToolsDisabled: false,
    schedule: (callback) => callback(),
  })

  window.isDestroyed = () => false
  window.restore = () => calls.push(['restore'])
  window.emit('blur')
  let minimizePrevented = false
  window.emit('minimize', { preventDefault: () => { minimizePrevented = true } })
  window.emit('leave-full-screen')

  assert.deepEqual(faults, ['window_blur', 'minimize', 'fullscreen_exit'])
  assert.equal(minimizePrevented, true)
  assert.deepEqual(calls.slice(-5), [
    ['restore'],
    ['kiosk', true],
    ['fullscreen', true],
    ['kiosk', true],
    ['fullscreen', true],
  ])
})

test('focus, restore, resize, and maximize changes reassert authorized exam presentation', () => {
  const { window, calls } = createWindow()
  window.webContents = new EventEmitter()
  window.isDestroyed = () => false
  window.isMinimized = () => false
  registerExamWindowRestrictions(window, {
    getSecurity: () => ({ fullscreenRequired: true }),
    reportExamFault: () => {},
    reportSecurityViolation: () => {},
    devToolsDisabled: false,
    schedule: (callback) => callback(),
  })

  window.emit('focus')
  window.emit('restore')
  window.emit('resize')
  window.emit('maximize')
  assert.deepEqual(calls.filter(([name]) => name === 'kiosk'), [
    ['kiosk', true],
    ['kiosk', true],
    ['kiosk', true],
    ['kiosk', true],
  ])
  assert.deepEqual(calls.filter(([name]) => name === 'fullscreen'), [
    ['fullscreen', true],
    ['fullscreen', true],
    ['fullscreen', true],
    ['fullscreen', true],
  ])
})

test('display changes restore fullscreen only for an active fullscreen-required exam', () => {
  const screen = new EventEmitter()
  const { window, calls } = createWindow()
  window.isDestroyed = () => false
  window.isMinimized = () => false
  let security = null
  registerExamDisplayRestrictions(screen, {
    getWindow: () => window,
    getSecurity: () => security,
    schedule: (callback) => callback(),
  })

  screen.emit('display-metrics-changed')
  assert.equal(calls.length, 0)
  security = { fullscreenRequired: true }
  screen.emit('display-added')
  screen.emit('display-removed')
  assert.deepEqual(calls, [
    ['kiosk', true],
    ['fullscreen', true],
    ['kiosk', true],
    ['fullscreen', true],
  ])
})

test('devtools shortcuts are blocked only when the app policy disables them', () => {
  const { window } = createWindow()
  window.webContents = new EventEmitter()
  let active = false
  const violations = []
  registerExamWindowRestrictions(window, {
    getSecurity: () => active ? { fullscreenRequired: true } : null,
    reportExamFault: () => {},
    reportSecurityViolation: (action) => violations.push(action),
    devToolsDisabled: () => active,
  })
  const event = { preventDefault() { this.prevented = true } }
  window.webContents.emit('before-input-event', event, {
    type: 'keyDown',
    key: 'F12',
  })
  assert.equal(event.prevented, undefined)

  active = true
  const activeEvent = { preventDefault() { this.prevented = true } }
  window.webContents.emit('before-input-event', activeEvent, {
    type: 'keyDown',
    key: 'F12',
  })
  assert.equal(activeEvent.prevented, true)
  assert.deepEqual(violations, ['devtools_suspected'])
})
