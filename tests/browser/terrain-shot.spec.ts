import { test, expect } from '@playwright/test'

// Capture-only helper for art-directing the desert. Not an assertion suite.
test('capture terrain', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    // A pre-existing setState-during-render warning is unrelated to the
    // terrain work, so it is not a regression signal here.
    if (message.type() === 'error' && !message.text().includes('while rendering a different component')) {
      errors.push(message.text())
    }
  })

  await page.goto('/')
  // The dev-only debug panels cover a quarter of the frame.
  await page.addStyleTag({ content: '.debug-overlay, .brand, .scroll-hint { display: none !important }' })
  await page.waitForFunction(() => document.querySelector('canvas') !== null)
  // Let the reveal timeline finish so the sand is fully drawn.
  await page.waitForTimeout(14000)
  await page.screenshot({ path: 'test-results/terrain.png' })
  expect(errors, errors.join('\n')).toEqual([])
})
