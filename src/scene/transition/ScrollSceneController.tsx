import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { useLoopScroll } from '../../experience/useLoopScroll'

/** Page content for each section, if it has any. Section 0 is the hero, which
 *  has none; section 1's placeholder lives in SecondScenePanel. */
const sectionContentIds: readonly (string | null)[] = [null, 'second-scene-content']

/**
 * Applies the transition state to the world: which scene root is drawn, how
 * visible each section's page content is, and - as coarse React state, only
 * when it actually changes - which section's content may take input.
 *
 * Only one scene root is ever visible, and the swap happens at
 * transitionTiming.switchAt, where the cloud covers the whole view.
 */
export function ScrollSceneController({ sceneRoots }: {
  sceneRoots: readonly React.RefObject<Group | null>[]
}) {
  const { state, setSceneSection } = useLoopScroll()
  const interactiveSection = useRef(0)
  const contentOpacity = useRef<number[]>(sectionContentIds.map(() => -1))

  useFrame(() => {
    const current = state.current
    // Leave every root visible while loading so shader warm-up (compileAsync
    // only walks visible objects) compiles the second scene too.
    if (current.phase === 'loading') return
    const transition = current.transition
    const active = current.phase === 'interactive' ? transition.activeSection : 0

    // Written every frame, not on change: a React re-render of a root would
    // otherwise be free to reset it.
    for (let index = 0; index < sceneRoots.length; index += 1) {
      const root = sceneRoots[index].current
      // Scene-graph visibility is mutable render state by design.
      // oxlint-disable-next-line react/immutability
      if (root) root.visible = index === active
    }

    for (let index = 0; index < sectionContentIds.length; index += 1) {
      const id = sectionContentIds[index]
      if (!id) continue
      const opacity = index === active ? transition.interaction : 0
      // DOM writes only when the value moves.
      if (Math.abs(opacity - contentOpacity.current[index]) < 0.002) continue
      contentOpacity.current[index] = opacity
      const element = document.getElementById(id)
      if (element) element.style.opacity = opacity.toFixed(3)
    }

    // Content takes input only once the storm has mostly cleared from it.
    const interactive = current.phase === 'interactive' && transition.interaction > 0.5 ? active : -1
    if (interactive !== interactiveSection.current) {
      interactiveSection.current = interactive
      setSceneSection(interactive)
    }
  })

  return null
}
