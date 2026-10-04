import { createContext, useContext } from 'react'
import type { MutableRefObject } from 'react'
import type { TransitionState } from './transitionTimeline'

export type Phase = 'loading' | 'intro' | 'interactive'
export type ScrollState = {
  target: number
  position: number
  phase: Phase
  introProgress: number
  reducedMotion: boolean
  /** Sandstorm transition for the current position, rewritten in place by
   *  the ExperienceDirector every frame. */
  transition: TransitionState
}

export type LoopController = {
  state: MutableRefObject<ScrollState>
  phase: Phase
  setPhase: (phase: Phase) => void
  jumpTo: (index: number, transition?: boolean) => void
  finishIntro: () => void
  /** Scene whose page content is showing. Coarse React state: it changes only
   *  when the storm swaps scenes, never per frame. */
  sceneSection: number
  setSceneSection: (section: number) => void
}

export const LoopScrollContext = createContext<LoopController | null>(null)

export function useLoopScroll() {
  const controller = useContext(LoopScrollContext)
  if (!controller) throw new Error('useLoopScroll requires LoopScrollProvider')
  return controller
}
