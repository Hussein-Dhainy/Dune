// Pulls embedded images out of a .glb so they can be reused as standalone web
// textures. The authored GroundSand005 maps only survive inside the exported
// terrain binary, so this recovers them without re-running the Blender bake.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

const [, , sourcePath, outputDir = 'public/textures'] = process.argv
if (!sourcePath) throw new Error('usage: node scripts/extract_glb_textures.mjs <file.glb> [outDir]')

const glb = readFileSync(sourcePath)
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error(`${sourcePath} is not a GLB container`)

// Walk the chunk table: a GLB is a 12-byte header followed by length-prefixed
// chunks, of which we need the JSON manifest and the binary payload.
let offset = 12
let manifest
let binary
while (offset < glb.length) {
  const length = glb.readUInt32LE(offset)
  const type = glb.readUInt32LE(offset + 4)
  const body = glb.subarray(offset + 8, offset + 8 + length)
  if (type === 0x4e4f534a) manifest = JSON.parse(body.toString('utf8'))
  if (type === 0x004e4942) binary = body
  offset += 8 + length
}
if (!manifest) throw new Error('GLB has no JSON chunk')

const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// glTF names textures by their role on the material, not on the image, so read
// the material bindings back to work out what each image actually is.
const roles = new Map()
for (const material of manifest.materials ?? []) {
  const pbr = material.pbrMetallicRoughness ?? {}
  const bindings = [
    [pbr.baseColorTexture, 'basecolor'],
    [pbr.metallicRoughnessTexture, 'roughness'],
    [material.normalTexture, 'normal'],
    [material.occlusionTexture, 'ao'],
    [material.emissiveTexture, 'emissive'],
  ]
  for (const [binding, role] of bindings) {
    if (!binding) continue
    const source = manifest.textures?.[binding.index]?.source
    if (source !== undefined) roles.set(source, role)
  }
}

mkdirSync(outputDir, { recursive: true })
const stem = basename(sourcePath).replace(/\.glb$/i, '')
const written = []
for (const [index, image] of (manifest.images ?? []).entries()) {
  if (image.bufferView === undefined) continue
  const view = manifest.bufferViews[image.bufferView]
  const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
  const role = roles.get(index) ?? `image${index}`
  const target = join(outputDir, `${stem}-${role}.${extensions[image.mimeType] ?? 'bin'}`)
  writeFileSync(target, bytes)
  written.push(`${target}  ${(bytes.length / 1024).toFixed(0)} KB  ${image.mimeType}`)
}

console.log(written.length ? written.join('\n') : 'no embedded images found')
