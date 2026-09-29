const svgNamespace = 'http://www.w3.org/2000/svg'

export type HoverMarker = {
  /** Position in CSS pixels relative to the canvas. */
  x: number
  y: number
  opacity: number
  label: string
}

/** Indices into the marker list; each pair is drawn as one connecting line. */
export type HoverMarkerEdge = readonly [number, number]

/**
 * Flat 2D tracking overlay drawn over the canvas: a crosshair and number on
 * each marked block, joined by thin lines. Plain SVG rather than scene
 * geometry, so lines stay exactly 1px and are never hidden behind blocks.
 * Elements are pooled and updated in place every frame, with no React renders.
 */
export function createHoverMarkerOverlay(container: HTMLElement, maxMarkers: number) {
  const svg = document.createElementNS(svgNamespace, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    overflow: 'visible',
  })
  const lineLayer = document.createElementNS(svgNamespace, 'g')
  const markerLayer = document.createElementNS(svgNamespace, 'g')
  svg.append(lineLayer, markerLayer)

  // Each marker links to at most two neighbours, so this many lines is enough.
  const lines = Array.from({ length: maxMarkers * 2 }, () => {
    const line = document.createElementNS(svgNamespace, 'line')
    line.setAttribute('stroke', '#ffffff')
    line.setAttribute('stroke-width', '1')
    line.setAttribute('visibility', 'hidden')
    lineLayer.append(line)
    return line
  })

  const markers = Array.from({ length: maxMarkers }, () => {
    const group = document.createElementNS(svgNamespace, 'g')
    group.setAttribute('visibility', 'hidden')
    const cross = document.createElementNS(svgNamespace, 'path')
    cross.setAttribute('d', 'M-5 0H5M0 -5V5')
    cross.setAttribute('stroke', '#ffffff')
    cross.setAttribute('stroke-width', '1')
    const text = document.createElementNS(svgNamespace, 'text')
    text.setAttribute('x', '8')
    text.setAttribute('y', '-7')
    text.setAttribute('fill', '#ffffff')
    text.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace')
    text.setAttribute('font-size', '11')
    text.setAttribute('letter-spacing', '0.04em')
    group.append(cross, text)
    markerLayer.append(group)
    return { group, text }
  })

  container.append(svg)

  return {
    update(current: readonly HoverMarker[], edges: readonly HoverMarkerEdge[]) {
      for (const [index, { group, text }] of markers.entries()) {
        const marker = current[index]
        if (!marker || marker.opacity <= 0.001) {
          group.setAttribute('visibility', 'hidden')
          continue
        }
        group.setAttribute('visibility', 'visible')
        group.setAttribute('transform', `translate(${marker.x.toFixed(1)} ${marker.y.toFixed(1)})`)
        group.setAttribute('opacity', marker.opacity.toFixed(3))
        if (text.textContent !== marker.label) text.textContent = marker.label
      }

      for (const [index, line] of lines.entries()) {
        const edge = edges[index]
        const from = edge && current[edge[0]]
        const to = edge && current[edge[1]]
        const opacity = from && to ? Math.min(from.opacity, to.opacity) * 0.6 : 0
        if (!from || !to || opacity <= 0.001) {
          line.setAttribute('visibility', 'hidden')
          continue
        }
        line.setAttribute('visibility', 'visible')
        line.setAttribute('x1', from.x.toFixed(1))
        line.setAttribute('y1', from.y.toFixed(1))
        line.setAttribute('x2', to.x.toFixed(1))
        line.setAttribute('y2', to.y.toFixed(1))
        line.setAttribute('opacity', opacity.toFixed(3))
      }
    },
    dispose() {
      svg.remove()
    },
  }
}
