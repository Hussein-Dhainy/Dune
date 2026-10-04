import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The intro advances at most 0.1s per rendered frame, so under software
// rendering (a few frames per second) it takes far longer than its 3.2s.
const introTimeout = 45_000
test.setTimeout(90_000)

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
  await page.locator('.debug-overlay:not(.controller-debug)').evaluateAll((elements: HTMLDetailsElement[]) => {
    for (const element of elements) element.open = false
  })
  await expect(page.locator('.scroll-hint')).toBeVisible({ timeout: introTimeout })
  await expect(page.locator('.controller-debug output')).toContainText('interactive')
}

test('intro ignores input and hands off at the beginning without replaying on resize', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.loop-scroll')).toBeHidden()
  await page.mouse.wheel(0, 2000)
  await expect(page.locator('.scroll-hint')).toBeVisible({ timeout: introTimeout })
  await expect.poll(async () => (await readState(page)).target).toBe(0)
  await page.setViewportSize({ width: 900, height: 650 })
  await expect(page.locator('.scroll-hint')).toBeVisible()
  await expect.poll(async () => (await readState(page)).target).toBe(0)
  expect(errors).toEqual([])
})

test('native scrolling and keyboard move forward and reverse across the seam', async ({ page }) => {
  await openExperience(page)
  const container = page.locator('.loop-scroll')
  await container.focus()
  await page.keyboard.press('ArrowUp')
  await expect.poll(async () => (await readState(page)).position).toBeLessThan(-0.02)
  // Backwards over the seam lands in the loop's last section.
  await expect(page.locator('.controller-debug output')).toContainText('Second scene')
  await page.keyboard.press('PageDown')
  await expect.poll(async () => (await readState(page)).position).toBeGreaterThan(0)
  await page.mouse.move(100, 600)
  await page.mouse.wheel(0, 1200)
  await expect.poll(async () => (await readState(page)).target).toBeGreaterThan(1)
})

test('recentering preserves accumulated movement and does not count synthetic scroll events', async ({ page }) => {
  await openExperience(page)
  for (const fraction of [0.76, 0.24, 0.76, 0.76]) {
    const before = await readState(page)
    const delta = await page.locator('.loop-scroll').evaluate((element, fraction) => {
      const before = element.scrollTop
      element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction
      return (element.scrollTop - before) / 520
    }, fraction)
    const expected = before.target + delta
    await expect.poll(async () => Math.abs((await readState(page)).target - expected)).toBeLessThan(0.003)
    await expect.poll(async () => page.locator('.loop-scroll').evaluate((element) =>
      element.scrollTop / (element.scrollHeight - element.clientHeight))).toBeGreaterThan(0.49)
    await expect.poll(async () => page.locator('.loop-scroll').evaluate((element) =>
      element.scrollTop / (element.scrollHeight - element.clientHeight))).toBeLessThan(0.51)
  }
  expect((await readState(page)).target).toBeGreaterThan(90)
  await expect.poll(async () => {
    const { position, target } = await readState(page)
    return Math.abs(position - target)
  }, { timeout: 15_000 }).toBeLessThan(0.003)
})

test('debug section jumps work and reduced motion skips the animated intro', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openExperience(page)
  await page.getByRole('button', { name: 'Pyramid', exact: true }).click()
  await expect.poll(async () => (await readState(page)).position).toBe(0)
  await page.getByRole('button', { name: 'Transition 1', exact: true }).click()
  await expect.poll(async () => (await readState(page)).position).toBe(1.2)
  // Reduced motion still reaches the transition, with no storm yet at its start.
  await expect(page.locator('.controller-debug output')).toContainText('Wipe 0%')
})

test('touch swipe drives native scrolling', async ({ page, context, isMobile }) => {
  test.skip(!isMobile, 'Touch-specific input')
  await openExperience(page)
  const session = await context.newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 650 }] })
  for (const y of [600, 550, 500, 450, 400, 350]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y }] })
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => (await readState(page)).target).toBeGreaterThan(0.1)
})

test('loading an additional asset keeps the interactive timeline alive', async ({ page }) => {
  await openExperience(page)
  await page.route('**/late-texture.svg', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="white"/></svg>' })
  })
  await page.evaluate(async () => {
    // Use the application's Three.js instance so the actual loading manager is exercised.
    const modulePath = '/tests/browser/assetLoader.ts'
    const { loadTexture } = await import(modulePath)
    await loadTexture('/late-texture.svg')
  })
  await expect(page.locator('.scroll-hint')).toBeVisible()
  await page.getByRole('button', { name: 'Transition 1', exact: true }).click()
  // A 1.2-unit damped move takes a while at software-rendered frame rates.
  await expect.poll(async () => (await readState(page)).position, { timeout: 15_000 }).toBeGreaterThan(1.19)
  await page.locator('.loop-scroll').focus()
  // ~1 unit into the 1.8-unit transition: the wipe should be most of the way up.
  for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowDown')
  await expect.poll(async () => {
    const cover = (await readState(page)).text.match(/Wipe (\d+)%/)
    return Number(cover?.[1] ?? 0)
  }).toBeGreaterThan(50)
})
