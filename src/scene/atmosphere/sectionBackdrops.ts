/**
 * What each section in cycle.ts sits in front of: the pyramid's desert sky
 * over the real terrain, or the second scene's distant dune backdrop (see
 * secondSceneLook). Shared by the main render and by the incoming-scene
 * render that shows behind the wipe.
 */
export const sectionBackdrops: readonly ('sky' | 'dunes')[] = ['sky', 'dunes']

export function duneBackdropFor(section: number) {
  return sectionBackdrops[section] === 'dunes' ? 1 : 0
}
