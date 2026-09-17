import { Canvas } from '@react-three/fiber'
import { Suspense, useRef, useState } from 'react'
import { Scene } from './scene/Scene'
import { defaultLighting } from './scene/lighting'
import type { LightingSettings } from './scene/lighting'
import { LoopScrollProvider } from './experience/LoopScrollProvider'
import { ExperienceDirector } from './experience/ExperienceDirector'
import { DebugOverlay } from './experience/DebugOverlay'
import { LightingDebug } from './experience/LightingDebug'
import { useLoopScroll } from './experience/useLoopScroll'
import { CameraDebugControls, CameraDebugPanel } from './experience/CameraDebug'
import type { CameraPose } from './experience/cameraPath'

function Interface({ lighting, setLighting, cameraDebugEnabled, setCameraDebugEnabled, cameraPose }: {
  lighting: LightingSettings
  setLighting: React.Dispatch<React.SetStateAction<LightingSettings>>
  cameraDebugEnabled: boolean
  setCameraDebugEnabled: (enabled: boolean) => void
  cameraPose: React.MutableRefObject<CameraPose>
}) {
  const { phase } = useLoopScroll()
  return (
    <>
      <header className="brand">DUNE <span>Scene navigation prototype</span></header>
      {phase === 'loading' && <div className="loading" role="status">Preparing scene…</div>}
      <div id="transition-veil" className="transition-veil" aria-hidden="true" />
      {phase === 'interactive' && <p className="scroll-hint">Scroll vertically to explore</p>}
      {import.meta.env.DEV && <DebugOverlay />}
      {import.meta.env.DEV && <LightingDebug lighting={lighting} setLighting={setLighting} />}
      {import.meta.env.DEV && <CameraDebugPanel enabled={cameraDebugEnabled} setEnabled={setCameraDebugEnabled} pose={cameraPose} />}
    </>
  )
}

export default function App() {
  const [lighting, setLighting] = useState(defaultLighting)
  const [cameraDebugEnabled, setCameraDebugEnabled] = useState(false)
  const cameraPose = useRef<CameraPose>({ position: [-3, 3.5, 15.5], target: [0, 1.2, 0] })
  return (
    <main className={`experience${cameraDebugEnabled ? ' camera-debug' : ''}`}>
      <LoopScrollProvider>
        <Canvas shadows camera={{ position: [0, 22, 0.01], fov: 45 }} dpr={[1, 2]}>
          <Suspense fallback={null}>
            <Scene lighting={lighting} />
          </Suspense>
          <ExperienceDirector cameraDebugEnabled={cameraDebugEnabled} />
          {import.meta.env.DEV && <CameraDebugControls enabled={cameraDebugEnabled} pose={cameraPose} />}
        </Canvas>
        <Interface
          lighting={lighting}
          setLighting={setLighting}
          cameraDebugEnabled={cameraDebugEnabled}
          setCameraDebugEnabled={setCameraDebugEnabled}
          cameraPose={cameraPose}
        />
      </LoopScrollProvider>
    </main>
  )
}
