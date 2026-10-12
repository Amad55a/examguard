import { useEffect, useRef, useState } from 'react'

const HEARTBEAT_INTERVAL_MS = 12_000
const SNAPSHOT_INTERVAL_MS = 30_000

export default function ExamGuardCameraMonitor({ required = false }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [retryKey, setRetryKey] = useState(0)
  const [cameraState, setCameraState] = useState('starting')
  const [message, setMessage] = useState('')
  const [heartbeatError, setHeartbeatError] = useState(false)

  useEffect(() => {
    if (!required) return undefined
    let cancelled = false
    let heartbeatTimer
    let snapshotTimer
    let stream

    const sendHeartbeat = async (cameraOk, snapshot, note) => {
      try {
        await window.examGuard.sendProctorHeartbeat({
          cameraOk,
          ...(snapshot ? { snapshot } : {}),
          ...(note ? { note } : {}),
        })
        if (!cancelled) setHeartbeatError(false)
      } catch {
        if (!cancelled) setHeartbeatError(true)
      }
    }

    const captureSnapshot = () => {
      const video = videoRef.current
      if (!video || video.readyState < 2) return null
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const context = canvas.getContext('2d')
      if (!context) return null
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.55)
    }

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is unavailable in this environment.')
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setCameraState('active')
        setMessage('')
        await sendHeartbeat(true)
        heartbeatTimer = setInterval(() => {
          const active = streamRef.current?.getVideoTracks?.()[0]?.readyState === 'live'
          setCameraState(active ? 'active' : 'unavailable')
          void sendHeartbeat(active, undefined, active ? undefined : 'camera_lost')
        }, HEARTBEAT_INTERVAL_MS)
        snapshotTimer = setInterval(() => {
          const snapshot = captureSnapshot()
          if (snapshot) void sendHeartbeat(true, snapshot)
        }, SNAPSHOT_INTERVAL_MS)
      } catch (error) {
        if (cancelled) return
        stream?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setCameraState('unavailable')
        setMessage(error?.message || 'Camera permission was denied.')
        const note = error?.name === 'NotFoundError' ? 'camera_unavailable' : 'camera_denied'
        void sendHeartbeat(false, undefined, note)
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      clearInterval(heartbeatTimer)
      clearInterval(snapshotTimer)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [required, retryKey])

  if (!required) return null

  return (
    <aside className="exam-camera-monitor" aria-label="Required exam camera">
      <strong>{cameraState === 'active' ? 'Camera on' : 'Camera required'}</strong>
      <video ref={videoRef} muted playsInline />
      {message && <p role="alert">{message}</p>}
      {heartbeatError && (
        <p role="status">Camera status could not reach UniCORE. Check the network connection.</p>
      )}
      {cameraState === 'unavailable' && (
        <button type="button" onClick={() => setRetryKey((key) => key + 1)}>
          Retry camera
        </button>
      )}
    </aside>
  )
}
