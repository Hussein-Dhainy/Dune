import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Capture-only helper for art-directing the second scene, in the manner of
// terrain-shot.spec.ts, plus the few things about it only a browser can
// check: that the model loads, that scrolling back lands on the same frame,
// and that the camera ignores the cursor there.
const introTimeout = 45_000
test.setTimeout(240_000)

// Cycle positions, in scroll units (see cycle.ts): section 0 holds for 1.2 and
// transitions for 1.8, then the second scene holds from 3 and leaves from 4.2.
const stops = [
  ['entry-wipe', 1.2 + 1.8 * 0.5],
  ['entry-rising', 1.2 + 1.8 * 0.72],
  ['entry-settling', 1.2 + 1.8 * 0.9],
  ['hold', 3.6],
  ['exit-lifting', 4.2 + 1.8 * 0.3],
  ['exit-leaving', 4.2 + 1.8 * 0.42],
] as const

async function readState(page: Page) {
  const text = await page.locator('.controller-debug output').textContent() ?? ''
  const numbers = text.match(/Position ([\d.-]+) \/ Target ([\d.-]+)/)!
  return { position: Number(numbers[1]), target: Number(numbers[2]), text }
}

async function openExperience(page: Page) {
  await page.goto('/')
  await page.locator('.controller-debug').evaluate((element: HTMLDetailsElement) => {
    element.open = true
  })
  await expect(page.locator('.scroll-hint')).toBeVisible({ timeout: introTimeout })
  await expect(page.locator('.controller-debug output')).toContainText('interactive')
  // The dev-only debug panels cover a quarter of the frame. Hidden with
  // opacity so the controller readout stays readable to the test.
  await page.addStyleTag({ content: '.debug-overlay { opacity: 0 !important; pointer-events: none !important }' })
}

/** Scrolls the real scroll container until the experience rests at `position`. */
async function scrollTo(page: Page, position: number) {
  const { target } = await readState(page)
  await page.locator('.loop-scroll').evaluate((element, units) => {
    element.scrollTop += units * 520
  }, position - target)
  // The readout refreshes on a timer, so wait for it rather than re-scrolling.
  await expect.poll(async () => Math.abs((await readState(page)).target - position), { timeout: 15_000 })
    .toBeLessThan(0.004)
  await expect.poll(async () => {
    const state = await readState(page)
    return Math.abs(state.position - position)
  }, { timeout: 30_000 }).toBeLessThan(0.004)
  // A few frames for the render to catch up with the settled position.
  await page.waitForTimeout(600)
}

test('capture the shard through entry, hold and exit, forwards and back', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('while rendering a different component')) {
      errors.push(message.text())
    }
  })
  const modelResponse = page.waitForResponse((response) => response.url().includes('/models/hex-cylinder-ripple-untextured.glb'))
  // Reduced motion removes the idle sway and the scroll damping, so every
  // stop is a function of the scroll position alone and frames can be compared.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openExperience(page)
  expect((await modelResponse).ok()).toBe(true)

  const shot = (name: string) => `test-results/shard-${testInfo.project.name}-${name}.png`
  for (const [name, position] of stops) {
    await scrollTo(page, position)
    await page.screenshot({ path: shot(name) })
  }
  // Back the way it came: the same positions must show the same frames.
  for (const [name, position] of [...stops].reverse()) {
    await scrollTo(page, position)
    await page.screenshot({ path: shot(`${name}-reverse`) })
  }
  expect(errors, errors.join('\n')).toEqual([])
})

test('the cursor leans the shard but never the camera', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'Pointer lean is mouse-only')
  await openExperience(page)
  const size = page.viewportSize()!
  await page.mouse.move(size.width / 2, size.height / 2)
  await scrollTo(page, 3.6)
  const shot = (name: string) => `test-results/shard-${testInfo.project.name}-pointer-${name}.png`
  await page.screenshot({ path: shot('centre') })
  await page.mouse.move(size.width - 4, 4, { steps: 8 })
  // The lean is heavily damped; give it time to arrive.
  await page.waitForTimeout(4000)
  await page.screenshot({ path: shot('top-right') })
  await page.mouse.move(4, size.height - 4, { steps: 8 })
  await page.waitForTimeout(4000)
  await page.screenshot({ path: shot('bottom-left') })
})
