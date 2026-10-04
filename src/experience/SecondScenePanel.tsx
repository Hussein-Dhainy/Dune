import { useLoopScroll } from './useLoopScroll'

/**
 * PLACEHOLDER page content for the second scene. It sits inside the scroll
 * container (a sticky, pointer-transparent layer), so wheel and touch over it
 * keep driving the experience. Its opacity is written per frame by
 * ScrollSceneController; whether it takes input is coarse React state that
 * only flips once the storm has cleared.
 */
export function SecondScenePanel() {
  const { sceneSection, jumpTo } = useLoopScroll()
  const interactive = sceneSection === 1
  return (
    <div className="scene-content-layer">
      <section
        id="second-scene-content"
        className={`scene-content${interactive ? ' is-interactive' : ''}`}
        aria-label="Second scene"
        aria-hidden={!interactive}
        // Hidden content must not be focusable or clickable.
        inert={!interactive}
      >
        <p className="scene-content-eyebrow">Placeholder</p>
        <h2>Second scene</h2>
        <p>This location has not been designed yet. It exists so the sandstorm transition has somewhere to arrive.</p>
        <button type="button" onClick={() => jumpTo(0)}>Back to the pyramid</button>
      </section>
    </div>
  )
}
