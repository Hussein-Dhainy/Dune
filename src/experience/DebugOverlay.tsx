import { useEffect, useRef } from 'react'
import { sampleCycle, sections } from './cycle'
import { useLoopScroll } from './useLoopScroll'

export function DebugOverlay() {
  const { state, phase, jumpTo, finishIntro } = useLoopScroll()
  const output = useRef<HTMLOutputElement>(null)
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = state.current
      const sample = sampleCycle(current.position)
      if (output.current) output.current.textContent = `Position ${current.position.toFixed(3)} / Target ${current.target.toFixed(3)}\nCycle ${(sample.progress * 100).toFixed(1)}% / ${sections[sample.index].label}\nTransition ${(sample.transition * 100).toFixed(1)}% / ${current.phase}`
    }, 100)
    return () => window.clearInterval(timer)
  }, [state])

  return (
    <details className="debug-overlay controller-debug">
      <summary>Controller debug</summary>
      <output ref={output} />
      <div className="debug-buttons">
        {sections.map((section, index) => (
          <div key={section.id}>
            <button disabled={phase !== 'interactive'} onClick={() => jumpTo(index)}>{section.label}</button>
            <button disabled={phase !== 'interactive'} onClick={() => jumpTo(index, true)}>Transition {index + 1}</button>
          </div>
        ))}
        {phase === 'intro' && <button onClick={finishIntro}>Skip intro</button>}
      </div>
    </details>
  )
}
