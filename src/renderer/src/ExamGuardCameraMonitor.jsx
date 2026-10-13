import { useEffect, useRef, useState } from 'react'

const HEARTBEAT_INTERVAL_MS = 12_000
const SNAPSHOT_INTERVAL_MS = 30_000

export default function ExamGuardCameraMonitor({
  cameraRequired = false,
  microphoneRequired = false,
}) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [retryKey, setRetryKey] = useState(0)
  const [cameraActive, setCameraActive] = useState(false)
  const [microphoneActive, setMicrophoneActive] = useState(false)
  const [message, setMessage] = useState('')
  const [heartbeatError, setHeartbeatError] = useState(false)
  const required = cameraRequired || microphoneRequired

  useEffect(() => {
    if (!required) return undefined
    let cancelled = false
    let heartbeatTimer
    let snapshotTimer
    let stream

    const sendHeartbeat = async (cameraOk, microphoneOk, snapshot, note) => {
      try {
        await window.examGuard.sendProctorHeartbeat({
          ...(cameraRequired ? { cameraOk } : {}),
          ...(microphoneRequired ? { microphoneOk } : {}),
          ...(snapshot ? { snapshot } : {}),
          ...(note ? { note } : {}),
        })
        if (!cancelled) setHeartbeatError(false)
      } catch {
        if (!cancelled) setHeartbeatError(true)
      }
    }

    const isCameraActive = () =>
      !cameraRequired || streamRef.current?.getVideoTracks?.()[0]?.readyState === 'live'
    const isMicrophoneActive = () =>
      !microphoneRequired || streamRef.current?.getAudioTracks?.()[0]?.readyState === 'live'

    const captureSnapshot = () => {
      const video = videoRef.current
      if (!cameraRequired || !video || video.readyState < 2) return null
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const context = canvas.getContext('2d')
      if (!context) return null
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.55)
    }

    const sendCurrentStatus = (note) =>
      sendHeartbeat(isCameraActive(), isMicrophoneActive(), undefined, note)

    const startMonitoring = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera or microphone access is unavailable in this environment.')
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: cameraRequired
            ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 } }
            : false,
          audio: microphoneRequired,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (cameraRequired && videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setCameraActive(isCameraActive())
        setMicrophoneActive(isMicrophoneActive())
        setMessage('')
        await sendCurrentStatus()
        heartbeatTimer = setInterval(() => {
          const cameraOk = isCameraActive()
          const microphoneOk = isMicrophoneActive()
          setCameraActive(cameraOk)
          setMicrophoneActive(microphoneOk)
          const note = cameraRequired && !cameraOk
            ? 'camera_lost'
            : microphoneRequired && !microphoneOk
              ? 'microphone_lost'
              : undefined
          void sendHeartbeat(cameraOk, microphoneOk, undefined, note)
        }, HEARTBEAT_INTERVAL_MS)
        if (cameraRequired) {
          snapshotTimer = setInterval(() => {
            const snapshot = captureSnapshot()
            if (snapshot) void sendCurrentStatusWithSnapshot(snapshot)
          }, SNAPSHOT_INTERVAL_MS)
        }
      } catch (error) {
        if (cancelled) return
        stream?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setCameraActive(false)
        setMicrophoneActive(false)
        setMessage(error?.message || 'Required device permission was denied.')
        const unavailable = error?.name === 'NotFoundError'
        const note = cameraRequired
          ? unavailable ? 'camera_unavailable' : 'camera_denied'
          : unavailable ? 'microphone_unavailable' : 'microphone_denied'
        void sendHeartbeat(false, false, undefined, note)
      }
    }

    const sendCurrentStatusWithSnapshot = (snapshot) =>
      sendHeartbeat(isCameraActive(), isMicrophoneActive(), snapshot)

    void startMonitoring()
    return () => {
      cancelled = true
      clearInterval(heartbeatTimer)
      clearInterval(snapshotTimer)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [cameraRequired, microphoneRequired, required, retryKey])

  if (!required) return null

  return (
    <aside className="exam-camera-monitor" aria-label="Required exam device monitoring">
      {cameraRequired && (
        <>
          <strong>{cameraActive ? 'Camera on' : 'Camera required'}</strong>
          <video ref={videoRef} muted playsInline />
        </>
      )}
      {microphoneRequired && (
        <strong>{microphoneActive ? 'Microphone on' : 'Microphone required'}</strong>
      )}
      {microphoneRequired && (
        <p>Microphone status is monitored; audio is not recorded or transmitted.</p>
      )}
      {message && <p role="alert">{message}</p>}
      {heartbeatError && (
        <p role="status">Device status could not reach UniCORE. Check the network connection.</p>
      )}
      {(!cameraActive && cameraRequired || !microphoneActive && microphoneRequired) && (
        <button type="button" onClick={() => setRetryKey((key) => key + 1)}>
          Retry required devices
        </button>
      )}
    </aside>
  )
}
