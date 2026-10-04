import { Vector4 } from 'three'

/**
 * Hover trail on the hex formation. As the cursor crosses the stone it leaves
 * a continuous trail: every stretch of its path sends a soft front spreading
 * outward over the columns, revealing a thin, irregular triangle mesh -
 * scattered points joined into slivers and broad triangles, denser in some
 * places than others - which lingers and fades back to bare stone.
 *
 * The path is kept as a chain of short segments, each joining where the
 * cursor was to where it is now and carrying the time at both ends, so every
 * point along it spreads from the moment the cursor passed it.
 *
 * Fronts do not cross: like fire over grass, a front only spreads onto stone
 * no front has reached yet. Each point is lit by whichever front reached it
 * first, and only while that lasts; where two fronts meet they stop, and only
 * the outer edge of the whole lit area moves on. Once a spot has faded right
 * out it is fresh stone again.
 *
 * Segments live in the formation mesh's own object space, so the trail travels
 * with the stone however it turns. Its shading is in the column shader (see
 * applyColumnRippleShader); the functions below are its exact mirror, for the
 * line network and the tests.
 */
export const columnHover = {
  /** Trail segments alive at once. A slot is only reused once its segment
   *  is over, so none is ever cut short; enough for a sweep that never stops
   *  (maxSegments x minInterval covers life + linger). */
  maxSegments: 40,
  /** Object-space units a scan's front travels per second. */
  speed: 1.1,
  /** Seconds a scan's front travels: at full strength for the first half,
   *  fading out over the second. What it has revealed lingers on after.
   *  Long enough (speed x life ~ 4 units) to reach every column, cap to
   *  cap, from wherever on the stone it starts. */
  life: 3.6,
  /** Half-width of a scan's bright front, in object units. */
  front: 0.045,
  /** Once the front has passed a spot, its triangles stay lit for this many
   *  seconds, starting at this share of the front's strength then, and fade
   *  evenly the whole time - so a scan leaves a spreading patch of
   *  triangles behind it, however thin its front. A scan is over
   *  `life + linger` seconds after it starts. */
  linger: 3,
  lingerShare: 0.25,
  /** Mean side of a mesh triangle, in object units. */
  triangle: 0.17,
  /** How far each mesh point strays from its place on a regular grid, as a
   *  share of a triangle's side: the source of the slivers and odd angles. */
  jitter: 0.3,
  /** Density swing: the mesh is squeezed and stretched by up to this share
   *  of its scale, over patches about 2 pi / densityRate units across. */
  densityWarp: 0.45,
  densityRate: 1.1,
  /** Edge brightness at the scan's peak, and the faintest an edge gets
   *  relative to the brightest, for some line-to-line variation. */
  edgeGlow: 0.95,
  faintestEdge: 0.35,
  /** Under prefers-reduced-motion: no spreading front, just a soft patch of
   *  triangles this wide round the cursor, fading over `life`. */
  calmRadius: 0.8,
  /** A new segment needs this long since the last, and the cursor this far
   *  from where the last one ended; a fast sweep just makes longer ones.
   *  Further than `maxJoin` in one go, the trail breaks rather than bridge
   *  the gap. */
  minInterval: 0.165,
  minTravel: 0.12,
  maxJoin: 2.5,
  /** The cage round the stone sits a few units out, past where the stone's
   *  own scan has faded, so its glow lasts longer and spreads wider. */
  cageLife: 4.8,
  cageFront: 0.9,
  /** The stone's own scan creeps; the cage's glow runs ahead faster, or it
   *  would fade out before reaching the cage a few units away. */
  cageSpeed: 2.4,
  cageCalmRadius: 3,
  /** Warm off-white, as the line network round the stone. */
  color: [0.965, 0.933, 0.867] as const,
}

export type ColumnHoverUniforms = {
  /** Per segment, each end: x, y, z in object space, and when the cursor
   *  was there. An end time far in the past marks an empty slot. */
  uHoverStarts: { value: Vector4[] }
  uHoverEnds: { value: Vector4[] }
  uHoverTime: { value: number }
  uHoverCalm: { value: number }
}

const emptyStart = -1e4

/** One shared set, for the same reason as columnRippleUniforms. */
export function createHoverUniforms(): ColumnHoverUniforms {
  const slots = () => Array.from({ length: columnHover.maxSegments }, () => new Vector4(0, 0, 0, emptyStart))
  return {
    uHoverStarts: { value: slots() },
    uHoverEnds: { value: slots() },
    uHoverTime: { value: 0 },
    uHoverCalm: { value: 0 },
  }
}

export const columnHoverUniforms = createHoverUniforms()

function smoothstep(value: number, edge0: number, edge1: number) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** 0..1 strength of a scan's front `age` seconds in. */
function frontFade(age: number) {
  return 1 - smoothstep(age, columnHover.life * 0.5, columnHover.life)
}

/** The first front to reach a point that is still showing there: how long
 *  ago it arrived (negative while it is just about to), and how long it had
 *  travelled to get there. */
export type Arrival = { since: number; travel: number }

export function createArrival(): Arrival {
  return { since: -Infinity, travel: 0 }
}

export function resetArrival(arrival: Arrival) {
  arrival.since = -Infinity
  arrival.travel = 0
}

/**
 * Offers one segment's front to a point: `reach` from the segment's nearest
 * point, `age` seconds after the cursor passed it. It is kept if it reached
 * the point before any other front still showing there. Fronts that never got
 * this far, or whose triangles have already faded here, have no say - so a
 * spot that has faded right out is fresh stone again. Mirrors the GLSL.
 */
export function offerArrival(arrival: Arrival, reach: number, age: number) {
  const { speed, life, linger, front } = columnHover
  const travel = reach / speed
  if (travel >= life) return arrival
  const since = age - travel
  if (since >= linger || since <= -front / speed) return arrival
  if (since > arrival.since) {
    arrival.since = since
    arrival.travel = travel
  }
  return arrival
}

/**
 * 0..1 drawn at a point from its first arrival: brightest on the front, then
 * straight down to `lingerShare` of that the moment it has passed, fading
 * evenly to nothing over `linger` seconds. Fronts weaken over the second half
 * of their travel, and what they leave is as lit as they were.
 */
export function hoverFromArrival(arrival: Arrival) {
  const { speed, front, linger, lingerShare } = columnHover
  if (arrival.since === -Infinity) return 0
  const fade = frontFade(arrival.travel)
  const edge = (1 - smoothstep(Math.abs(arrival.since) * speed, 0, front)) * fade
  const left = arrival.since > 0 ? (1 - arrival.since / linger) * lingerShare * fade : 0
  return Math.max(edge, left)
}

/** Under reduced motion: no spreading front, just a soft patch round each
 *  point the cursor crossed, fading over `life + linger`. */
export function calmHover(reach: number, age: number) {
  const total = columnHover.life + columnHover.linger
  if (age < 0 || age >= total) return 0
  return (1 - smoothstep(reach, 0, columnHover.calmRadius)) * (1 - age / total)
}

/** 0..1 glow the trail gives the cage `distance` from the point it spreads from. */
export function cageStrength(distance: number, age: number, calm: boolean) {
  const { cageLife, cageFront, cageCalmRadius, cageSpeed } = columnHover
  if (age < 0 || age >= cageLife) return 0
  const fade = 1 - age / cageLife
  if (calm) return (1 - smoothstep(distance, 0, cageCalmRadius)) * fade
  return (1 - smoothstep(Math.abs(distance - age * cageSpeed), 0, cageFront)) * fade
}

/** Where one segment is nearest a point, and when the cursor was there. */
export type SegmentSample = { reach: number; age: number }

/**
 * Fills `out` for the point (x, y, z) against a segment from `start` to `end`
 * (x, y, z, time each) at time `now`: the distance to the nearest point on
 * it, and how long ago the cursor passed that point. Mirrors the GLSL.
 */
export function sampleSegment(
  x: number,
  y: number,
  z: number,
  start: Vector4,
  end: Vector4,
  now: number,
  out: SegmentSample,
) {
  const abX = end.x - start.x
  const abY = end.y - start.y
  const abZ = end.z - start.z
  const length = abX * abX + abY * abY + abZ * abZ
  const along = length > 1e-8
    ? Math.min(Math.max(((x - start.x) * abX + (y - start.y) * abY + (z - start.z) * abZ) / length, 0), 1)
    : 0
  out.reach = Math.hypot(x - start.x - abX * along, y - start.y - abY * along, z - start.z - abZ * along)
  out.age = now - (start.w + (end.w - start.w) * along)
  return out
}

/** Trail state on the CPU side: where and when the last segment ended, and
 *  whether the next one may carry on from there. */
export type HoverSpawner = {
  next: number
  lastTime: number
  lastX: number
  lastY: number
  lastZ: number
  joined: boolean
  /** The newest point a throttle turned away, still owed to the trail. */
  pending: boolean
  pendingX: number
  pendingY: number
  pendingZ: number
}

export function createHoverSpawner(): HoverSpawner {
  return {
    next: 0,
    lastTime: emptyStart,
    lastX: 0,
    lastY: 0,
    lastZ: 0,
    joined: false,
    pending: false,
    pendingX: 0,
    pendingY: 0,
    pendingZ: 0,
  }
}

/**
 * Extends the trail to (x, y, z) at `time`: a segment from where the last one
 * ended, or - when the trail is broken - a single point to start a new one.
 * Nothing is added when the last segment was too recent or the cursor has
 * barely moved, or when every slot is still in use; the next segment then
 * simply reaches back further, so the trail never has a gap. A point turned
 * away is kept as pending, for flushHoverTrail to add once the throttle
 * allows - otherwise a cursor that stops just after one would leave the
 * trail ending short of where it rests. A tap (`force`) always starts a point
 * of its own. Writes the shared uniforms in place; returns whether a segment
 * was added.
 */
export function emitHoverTrail(
  spawner: HoverSpawner,
  x: number,
  y: number,
  z: number,
  time: number,
  force = false,
  uniforms = columnHoverUniforms,
) {
  const { life, linger, minInterval, minTravel, maxJoin, maxSegments } = columnHover
  const travel = Math.hypot(x - spawner.lastX, y - spawner.lastY, z - spawner.lastZ)
  const join = spawner.joined && !force && travel <= maxJoin
  if (!force) {
    const held = time - uniforms.uHoverEnds.value[spawner.next].w < life + linger
      || time - spawner.lastTime < minInterval
      || (join && travel < minTravel)
    if (held) {
      spawner.pending = true
      spawner.pendingX = x
      spawner.pendingY = y
      spawner.pendingZ = z
      return false
    }
  }
  spawner.pending = false
  const start = uniforms.uHoverStarts.value[spawner.next]
  if (join) start.set(spawner.lastX, spawner.lastY, spawner.lastZ, spawner.lastTime)
  else start.set(x, y, z, time)
  uniforms.uHoverEnds.value[spawner.next].set(x, y, z, time)
  spawner.next = (spawner.next + 1) % maxSegments
  spawner.lastTime = time
  spawner.lastX = x
  spawner.lastY = y
  spawner.lastZ = z
  // A tap stands alone; a hover carries on from here.
  spawner.joined = !force
  return true
}

/** The cursor has left the stone: the next segment starts a new trail. */
export function breakHoverTrail(spawner: HoverSpawner) {
  spawner.joined = false
  spawner.pending = false
}

/** Adds the pending point, if any, once the throttle lets it through: for
 *  frames where the cursor has not moved. Returns whether one was added. */
export function flushHoverTrail(spawner: HoverSpawner, time: number, uniforms = columnHoverUniforms) {
  if (!spawner.pending) return false
  return emitHoverTrail(spawner, spawner.pendingX, spawner.pendingY, spawner.pendingZ, time, false, uniforms)
}

/** Empties every segment, e.g. when the formation leaves the stage. */
export function clearHoverTrail(spawner: HoverSpawner, uniforms = columnHoverUniforms) {
  for (const end of uniforms.uHoverEnds.value) end.w = emptyStart
  for (const start of uniforms.uHoverStarts.value) start.w = emptyStart
  spawner.lastTime = emptyStart
  spawner.joined = false
  spawner.pending = false
}

const glsl = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(value))

/** GLSL for the column shader: declarations, the vertex varyings, and the
 *  fragment code that adds the lattice to the emissive light. */
export const hoverShaderChunks = {
  vertexDeclarations: /* glsl */ `varying vec3 vHoverRest;
varying vec3 vHoverNormal;`,
  /** After the columns' slide: the rest pose carries the lattice and meets
   *  the trail (recorded at rest too), so both ride with their column. */
  vertexBody: /* glsl */ `vHoverRest = position;
  vHoverNormal = objectNormal;`,
  fragmentDeclarations: /* glsl */ `varying vec3 vHoverRest;
varying vec3 vHoverNormal;
uniform vec4 uHoverStarts[${columnHover.maxSegments}];
uniform vec4 uHoverEnds[${columnHover.maxSegments}];
uniform float uHoverTime;
uniform float uHoverCalm;

float hoverFront(float age) {
  return 1.0 - smoothstep(${glsl(columnHover.life * 0.5)}, ${glsl(columnHover.life)}, age);
}

float hoverCalm(float reach, float age) {
  float total = ${glsl(columnHover.life + columnHover.linger)};
  if (age < 0.0 || age >= total) return 0.0;
  return (1.0 - smoothstep(0.0, ${glsl(columnHover.calmRadius)}, reach)) * (1.0 - age / total);
}

vec2 hoverJitter(vec2 cell) {
  return fract(sin(vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)))) * 43758.5453) - 0.5;
}

float hoverHash(vec2 cell, float salt) {
  return fract(sin(dot(cell, vec2(12.9898, 78.233)) + salt * 37.719) * 43758.5453);
}

// A mesh point: the grid point at "cell" of a triangular grid (skewed square
// cells, as in simplex noise), unskewed and then pushed off its place.
vec2 hoverMeshPoint(vec2 cell) {
  return cell - (cell.x + cell.y) * 0.2113249 + hoverJitter(cell) * ${glsl(columnHover.jitter * 0.8165)};
}

float hoverSegment(vec2 point, vec2 from, vec2 to) {
  vec2 along = to - from;
  float t = clamp(dot(point - from, along) / dot(along, along), 0.0, 1.0);
  return length(point - from - along * t);
}

// 0..1 coverage of the nearest mesh edge at "point" (mesh units), each edge
// at its own brightness. "pixel" is one screen pixel in mesh units.
float hoverMesh(vec2 point, float pixel) {
  vec2 base = floor(point + (point.x + point.y) * 0.3660254);
  float lit = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 cell = base + vec2(float(dx), float(dy));
      vec2 here = hoverMeshPoint(cell);
      // Every grid point owns three edges: right, up, and diagonally up-right.
      vec2 ends[3] = vec2[3](vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(1.0, 1.0));
      for (int edge = 0; edge < 3; edge++) {
        float gap = hoverSegment(point, here, hoverMeshPoint(cell + ends[edge])) / pixel;
        float coverage = 1.0 - smoothstep(0.25, 0.9, gap);
        float tone = mix(${glsl(columnHover.faintestEdge)}, 1.0, hoverHash(cell, float(edge)));
        lit = max(lit, coverage * tone);
      }
    }
  }
  return lit;
}`,
  /** Into the emissive light: the mesh's edges, wherever a scan is passing. */
  fragmentBody: /* glsl */ `{
    // The first front still showing to reach this point: how long ago, and
    // how far it had come (see offerArrival).
    float since = -1e9;
    float travel = 0.0;
    float calm = 0.0;
    for (int index = 0; index < ${columnHover.maxSegments}; index++) {
      vec4 end = uHoverEnds[index];
      // Over once even its newest end is: most slots, most of the time.
      if (uHoverTime - end.w >= ${glsl(columnHover.life + columnHover.linger)}) continue;
      vec4 start = uHoverStarts[index];
      // The nearest point on the segment, and when the cursor passed it.
      vec3 along = end.xyz - start.xyz;
      float span = dot(along, along);
      float t = span > 1e-8 ? clamp(dot(vHoverRest - start.xyz, along) / span, 0.0, 1.0) : 0.0;
      float reach = length(vHoverRest - start.xyz - along * t);
      float age = uHoverTime - mix(start.w, end.w, t);
      if (uHoverCalm > 0.5) {
        calm = max(calm, hoverCalm(reach, age));
        continue;
      }
      float arrivedFor = age - reach / ${glsl(columnHover.speed)};
      if (reach / ${glsl(columnHover.speed)} < ${glsl(columnHover.life)}
        && arrivedFor < ${glsl(columnHover.linger)}
        && arrivedFor > ${glsl(-columnHover.front / columnHover.speed)}
        && arrivedFor > since) {
        since = arrivedFor;
        travel = reach / ${glsl(columnHover.speed)};
      }
    }
    // Drawn from that first arrival alone, so fronts never cross: brightest
    // on the front, then straight down to a share of it, fading evenly.
    float hover = calm;
    if (since > -1e8) {
      float fade = hoverFront(travel);
      float edge = (1.0 - smoothstep(0.0, ${glsl(columnHover.front)}, abs(since) * ${glsl(columnHover.speed)})) * fade;
      float left = since > 0.0
        ? (1.0 - since / ${glsl(columnHover.linger)}) * ${glsl(columnHover.lingerShare)} * fade
        : 0.0;
      hover = max(edge, left);
    }
    if (hover > 0.001) {
      // Flat coordinates across the face: caps take X/Z, sides run across
      // the face and up the column, as the texture's UVs do.
      vec3 faceNormal = normalize(vHoverNormal);
      vec2 across = normalize(vec2(-faceNormal.z, faceNormal.x) + vec2(1e-5, 0.0));
      vec2 facePoint = abs(faceNormal.y) > 0.7
        ? vHoverRest.xz
        : vec2(dot(vHoverRest.xz, across), vHoverRest.y);
      // Into mesh units, squeezed in some patches and stretched in others: a
      // gentle warp, so the mesh stays one piece while its density varies.
      float scale = ${glsl(0.8165 / columnHover.triangle)};
      float rate = ${glsl(columnHover.densityRate)};
      float swing = ${glsl(columnHover.densityWarp)} * scale / rate;
      vec2 meshPoint = facePoint * scale + swing * vec2(
        sin(facePoint.x * rate + facePoint.y * rate * 0.6 + 1.7),
        sin(facePoint.y * rate - facePoint.x * rate * 0.5 + 4.1)
      );
      float pixel = max(length(fwidth(meshPoint)) * 0.7071, 1e-4);
      vec3 hoverColor = vec3(${columnHover.color.map(glsl).join(', ')});
      totalEmissiveRadiance += hoverColor * hover * hoverMesh(meshPoint, pixel) * ${glsl(columnHover.edgeGlow)};
    }
  }`,
}
