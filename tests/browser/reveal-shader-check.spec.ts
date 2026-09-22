import { test, expect } from '@playwright/test'

// Confirms the shader edit compiles at runtime and the reveal animation still
// plays (mid-reveal frame should differ from the fully-revealed frame).
test('reveal shader still animates without compile errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('while rendering a different component')) {
      errors.push(message.text())
    }
  })

  await page.goto('/')
  await page.addStyleTag({ content: '.debug-overlay, .brand, .scroll-hint { display: none !important }' })
  await page.waitForFunction(() => document.querySelector('canvas') !== null)
  await page.locator('.loading').waitFor({ state: 'detached', timeout: 15_000 })

  await page.waitForTimeout(2500)
  const midReveal = await page.screenshot()

  await page.waitForTimeout(12000)
  const settled = await page.screenshot()

  expect(errors, errors.join('\n')).toEqual([])
  expect(Buffer.compare(midReveal, settled)).not.toBe(0)
})
