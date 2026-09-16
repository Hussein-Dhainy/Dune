import { createContext, useContext } from 'react'
import type { MutableRefObject } from 'react'

export type Phase = 'loading' | 'intro' | 'interactive'
export type ScrollState = {
  target: number
  position: number
  phase: Phase
  introProgress: number
  reducedMotion: boolean
}

export type LoopController = {
  state: MutableRefObject<ScrollState>
  phase: Phase
  setPhase: (phase: Phase) => void
  jumpTo: (index: number, transition?: boolean) => void
  finishIntro: () => void
}

export const LoopScrollContext = createContext<LoopController | null>(null)

export function useLoopScroll() {
  const controller = useContext(LoopScrollContext)
  if (!controller) throw new Error('useLoopScroll requires LoopScrollProvider')
  return controller
}
