// Dev tool: headless visual check. Usage:
//   npm run build && npm run preview &   (port 4173)
//   node scripts/screenshot.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const out = process.argv[2] ?? 'screenshots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));

const waitReady = async () => {
  await page.waitForFunction(
    () => document.getElementById('loading-overlay')?.classList.contains('hidden'),
    null, { timeout: 90000 },
  );
  await page.waitForTimeout(1200);
};

const waitGenerated = async () => {
  await page.waitForFunction(
    () => document.getElementById('loading-overlay')?.classList.contains('hidden'),
    null, { timeout: 90000 },
  );
  await page.waitForTimeout(1500);
};

const switchAdvanced = async () => {
  await page.locator('[data-mode="advanced"]').click();
  await page.waitForSelector('#size-slider');
};

await page.goto('http://localhost:4173/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await waitReady();
await page.screenshot({ path: `${out}/default-s-course.png` });

// Manual example 1: the slotted frame (vertical loop through the slot).
await page.evaluate(() => {
  const Y = 'straight', I = 'inner';
  window.__railcube.renderProgram(['start', Y, Y, Y, Y, I, I, Y, Y, Y, Y, Y, Y, Y, Y, I, I, Y, Y, Y]);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/manual-frame.png` });

await switchAdvanced();
await page.selectOption('#kit-select', 'starter');
await page.locator('#elevation-slider').fill('0.5');
await page.locator('#elevation-slider').dispatchEvent('input');
await page.click('#generate-btn');
await page.waitForTimeout(500);
await waitGenerated();
await page.screenshot({ path: `${out}/generated-starter.png` });

await page.selectOption('#kit-select', 'deluxe');
await page.locator('#size-slider').fill('34');
await page.locator('#size-slider').dispatchEvent('input');
await page.locator('#elevation-slider').fill('0.7');
await page.locator('#elevation-slider').dispatchEvent('input');
await page.click('#generate-btn');
await page.waitForTimeout(500);
await waitGenerated();
await page.screenshot({ path: `${out}/generated-deluxe.png` });

await page.emulateMedia({ media: 'print' });
await page.screenshot({ path: `${out}/print-view.png` });

await browser.close();
console.log('DONE');
