// Film grain as a static SVG noise tile. It is rasterised once by the browser
// and only jittered by a stepped CSS transform, so it costs nothing in React or
// on the main thread per frame. Tile size must match --grain-tile in CSS.
const grainTile =
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>"
  + "<filter id='g' x='0' y='0' width='100%' height='100%'>"
  + "<feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>"
  + "<feColorMatrix type='saturate' values='0'/>"
  + '</filter>'
  + "<rect width='100%' height='100%' filter='url(%23g)'/></svg>"

const grainStyle = { backgroundImage: `url("data:image/svg+xml;utf8,${grainTile}")` }

/** Faint grain plus a soft vignette over the canvas, beneath the interface text.
 *  Siblings of the canvas rather than one wrapper: a positioned wrapper would
 *  be its own stacking context, isolating the grain's blend from the scene. */
export function GrainOverlay() {
  return (
    <>
      <div className="film-vignette" aria-hidden="true" />
      <div className="film-grain" aria-hidden="true" style={grainStyle} />
    </>
  )
}
