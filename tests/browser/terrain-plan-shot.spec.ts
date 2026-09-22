import { test } from '@playwright/test'

// Renders the height field straight to a canvas as a shaded relief map, so the
// dune pattern can be judged on its own terms. The hero camera angle flatters
// the terrain and hides whether crests actually read as a dune field.
test('capture terrain plan view', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => document.querySelector('canvas') !== null)

  const image = await page.evaluate(async () => {
    const module = await import('/src/scene/terrain/heightField.ts')
    const field = module.createDuneHeightField(module.defaultDuneSettings)

    const size = 700
    // Show the near field, where the camera actually looks, not the whole extent.
    const span = 260
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')!
    const pixels = context.createImageData(size, size)

    // Hillshade from a low north-west sun, the standard way to read relief.
    const sunX = -0.6
    const sunZ = -0.55
    const sunY = 0.58

    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const x = (column / size - 0.5) * span
        const z = (row / size - 0.5) * span
        const step = span / size
        const slopeX = field(x + step, z) - field(x - step, z)
        const slopeZ = field(x, z + step) - field(x, z - step)
        const length = Math.hypot(-slopeX, 2 * step, -slopeZ)
        const shade = (-slopeX * sunX + 2 * step * sunY + -slopeZ * sunZ) / length
        const value = Math.max(0, Math.min(1, shade)) * 235
        const offset = (row * size + column) * 4
        pixels.data[offset] = value
        pixels.data[offset + 1] = value * 0.92
        pixels.data[offset + 2] = value * 0.78
        pixels.data[offset + 3] = 255
      }
    }
    context.putImageData(pixels, 0, 0)
    return canvas.toDataURL('image/png')
  })

  const buffer = Buffer.from(image.split(',')[1], 'base64')
  const fs = await import('node:fs/promises')
  await fs.writeFile('test-results/terrain-plan.png', buffer)
})
