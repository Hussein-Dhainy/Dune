import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { cycleLength, nearestSectionPosition, scrollConfig, sections } from './cycle'
import { LoopScrollContext } from './useLoopScroll'
import type { Phase, ScrollState } from './useLoopScroll'

export function LoopScrollProvider({ children }: { children: ReactNode }) {
  const [phase, setReactPhase] = useState<Phase>('loading')
  const state = useRef<ScrollState>({ target: 0, position: 0, phase: 'loading', introProgress: 0, reducedMotion: false })
  const container = useRef<HTMLDivElement>(null)
  const previousTop = useRef(0)

  const setPhase = useCallback((next: Phase) => {
    state.current.phase = next
    setReactPhase(next)
  }, [])

  const recenter = useCallback(() => {
    const element = container.current
    if (!element) return
    const center = (element.scrollHeight - element.clientHeight) / 2
    element.scrollTop = center
    previousTop.current = element.scrollTop
  }, [])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { state.current.reducedMotion = preference.matches }
    update()
    preference.addEventListener('change', update)
    const element = container.current!
    recenter()
    const resizeObserver = new ResizeObserver(recenter)
    resizeObserver.observe(element)
    return () => {
      preference.removeEventListener('change', update)
      resizeObserver.disconnect()
    }
  }, [recenter])

  const finishIntro = useCallback(() => {
    state.current.target = 0
    state.current.position = 0
    state.current.introProgress = 1
    recenter()
    setPhase('interactive')
    container.current?.focus({ preventScroll: true })
  }, [recenter, setPhase])

  const jumpTo = useCallback((index: number, transition = false) => {
    if (state.current.phase !== 'interactive') return
    state.current.target = nearestSectionPosition(state.current.position, index, transition ? sections[index].hold : 0)
  }, [])

  const onScroll = () => {
    const element = container.current!
    const top = element.scrollTop
    const movement = top - previousTop.current
    previousTop.current = top
    if (state.current.phase === 'interactive') state.current.target += movement / scrollConfig.pixelsPerUnit
    const range = element.scrollHeight - element.clientHeight
    // Recenter well before an edge. Updating the baseline excludes this synthetic movement.
    if (top < range * 0.25 || top > range * 0.75) recenter()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (state.current.phase !== 'interactive') return
    let movement = 0
    switch (event.key) {
      case 'ArrowDown': movement = 80 / scrollConfig.pixelsPerUnit; break
      case 'ArrowUp': movement = -80 / scrollConfig.pixelsPerUnit; break
      case 'PageDown': movement = event.currentTarget.clientHeight / scrollConfig.pixelsPerUnit; break
      case 'PageUp': movement = -event.currentTarget.clientHeight / scrollConfig.pixelsPerUnit; break
      case ' ': movement = (event.shiftKey ? -1 : 1) * event.currentTarget.clientHeight / scrollConfig.pixelsPerUnit; break
      case 'Home': movement = -cycleLength; break
      case 'End': movement = cycleLength; break
      default: return
    }
    event.preventDefault()
    state.current.target += movement
  }

  return (
    <LoopScrollContext.Provider value={{ state, phase, setPhase, jumpTo, finishIntro }}>
      {children}
      <div
        ref={container}
        className="loop-scroll"
        tabIndex={0}
        role="region"
        aria-label="Looping scene navigation. Scroll or use arrow keys and Page Up or Page Down."
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        style={{ visibility: phase === 'interactive' ? 'visible' : 'hidden' }}
      >
        <div className="loop-scroll-spacer" />
      </div>
    </LoopScrollContext.Provider>
  )
}
