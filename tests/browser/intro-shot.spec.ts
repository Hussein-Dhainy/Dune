import { test } from '@playwright/test'

// Captures the top-down intro pose, before the camera settles into its main
// position. Checked separately from terrain-shot.spec.ts because the intro's
// straight-down view at wide aspect ratios is the tightest constraint on how
// small the terrain plane can be.
test('capture intro pose', async ({ page }) => {
  await page.goto('/')
  await page.addStyleTag({ content: '.debug-overlay, .brand, .scroll-hint { display: none !important }' })
  await page.waitForFunction(() => document.querySelector('canvas') !== null)
  // '.scroll-hint' only appears once the 3.2s intro tween finishes (camera
  // already at the main pose by then), so instead catch the moment loading
  // ends and the intro's top-down pose is still active.
  await page.locator('.loading').waitFor({ state: 'detached', timeout: 15_000 })
  await page.screenshot({ path: 'test-results/intro.png' })
})
