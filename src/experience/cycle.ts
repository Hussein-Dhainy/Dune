export const sections = [
  { id: 'pyramid', label: 'Pyramid', hold: 1.2, transition: 0.8 },
  { id: 'pillars', label: 'Pillars', hold: 1.2, transition: 0.8 },
  { id: 'portal', label: 'Portal', hold: 1.2, transition: 0.8 },
] as const

export const cycleLength = sections.reduce((sum, section) => sum + section.hold + section.transition, 0)
export const scrollConfig = { pixelsPerUnit: 850, damping: 0.22 }

export function wrap(value: number, length = cycleLength) {
  return ((value % length) + length) % length
}

export function sectionStart(index: number) {
  return sections.slice(0, index).reduce((sum, section) => sum + section.hold + section.transition, 0)
}

export function sampleCycle(position: number) {
  const progress = wrap(position)
  let start = 0
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]
    const duration = section.hold + section.transition
    if (progress < start + duration || index === sections.length - 1) {
      const local = progress - start
      return {
        index,
        nextIndex: (index + 1) % sections.length,
        progress: progress / cycleLength,
        sectionProgress: local / duration,
        transition: Math.max(0, Math.min(1, (local - section.hold) / section.transition)),
      }
    }
    start += duration
  }
  throw new Error('The cycle must contain at least one section')
}

export function smoothPosition(current: number, target: number, delta: number, damping: number) {
  return damping <= 0 ? target : current + (target - current) * -Math.expm1(-delta / damping)
}

export function nearestSectionPosition(position: number, index: number, offset = 0) {
  const start = sectionStart(index) + offset
  return start + Math.round((position - start) / cycleLength) * cycleLength
}
