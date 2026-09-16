import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { Scene } from './scene/Scene'
import { LoopScrollProvider } from './experience/LoopScrollProvider'
import { ExperienceDirector } from './experience/ExperienceDirector'
import { DebugOverlay } from './experience/DebugOverlay'
import { useLoopScroll } from './experience/useLoopScroll'

function Interface() {
  const { phase } = useLoopScroll()
  return (
    <>
      <header className="brand">DUNE <span>Scene navigation prototype</span></header>
      {phase === 'loading' && <div className="loading" role="status">Preparing scene…</div>}
      <div id="transition-veil" className="transition-veil" aria-hidden="true" />
      {phase === 'interactive' && <p className="scroll-hint">Scroll to explore · loops in both directions</p>}
      {import.meta.env.DEV && <DebugOverlay />}
    </>
  )
}

export default function App() {
  return (
    <main className="experience">
      <LoopScrollProvider>
        <Canvas camera={{ position: [0, 22, 0.01], fov: 45 }} dpr={[1, 2]}>
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
          <ExperienceDirector />
        </Canvas>
        <Interface />
      </LoopScrollProvider>
    </main>
  )
}
