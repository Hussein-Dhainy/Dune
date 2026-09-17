import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { CameraPose } from './cameraPath'
import { useLoopScroll } from './useLoopScroll'

type ControlsProps = {
  enabled: boolean
  pose: MutableRefObject<CameraPose>
}

export function CameraDebugControls({ enabled, pose }: ControlsProps) {
  const controls = useRef<OrbitControlsImpl>(null)

  useEffect(() => {
    if (!enabled || !controls.current) return
    controls.current.target.set(...pose.current.target)
    controls.current.update()
  }, [enabled, pose])

  const capturePose = () => {
    const orbit = controls.current
    if (!orbit) return
    const { position } = orbit.object
    const { target } = orbit
    // Debug interaction state stays mutable so dragging does not re-render React.
    // oxlint-disable-next-line react/immutability
    pose.current = {
      position: [position.x, position.y, position.z],
      target: [target.x, target.y, target.z],
    }
  }

  return (
    <OrbitControls
      ref={controls}
      enabled={enabled}
      enableDamping
      dampingFactor={0.08}
      minDistance={0.5}
      maxDistance={100}
      target={pose.current.target}
      onChange={capturePose}
    />
  )
}

type PanelProps = ControlsProps & {
  setEnabled: (enabled: boolean) => void
}

const round = (value: number) => Number(value.toFixed(3))

function poseSource(pose: CameraPose) {
  const position = pose.position.map(round).join(', ')
  const target = pose.target.map(round).join(', ')
  return `{ position: [${position}], target: [${target}] }`
}

export function CameraDebugPanel({ enabled, setEnabled, pose }: PanelProps) {
  const { phase, finishIntro } = useLoopScroll()
  const output = useRef<HTMLOutputElement>(null)

  useEffect(() => {
    if (!enabled) return
    const update = () => {
      if (output.current) output.current.textContent = poseSource(pose.current)
    }
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [enabled, pose])

  const toggle = () => {
    if (!enabled && phase !== 'interactive') finishIntro()
    setEnabled(!enabled)
  }

  const copyPose = () => {
    void navigator.clipboard?.writeText(poseSource(pose.current))
  }

  return (
    <details className="debug-overlay camera-debug-overlay" open>
      <summary>Camera lab</summary>
      <button onClick={toggle}>{enabled ? 'Stop positioning' : 'Position camera'}</button>
      {enabled && (
        <>
          <p>Drag to orbit · right-drag to pan · wheel to zoom</p>
          <output ref={output} />
          <button onClick={copyPose}>Copy camera pose</button>
        </>
      )}
    </details>
  )
}
