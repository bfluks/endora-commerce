import { test, expect } from '@playwright/test';
import { PAGES, settle, setTheme } from './_helpers';

// Storefront visual-parity matrix: every page-type family × {light, dark}, run under
// both the desktop and mobile projects defined in playwright.config.ts (× 2 viewports).
// Baseline is captured from the pre-migration build (T006); the migrated build must
// diff clean against it (SC-001 / FR-002).
//
// Usage:
//   STOREFRONT_URL=... npx playwright test           # diff against committed baseline
//   STOREFRONT_URL=... npx playwright test --update-snapshots   # capture/refresh baseline
for (const pageDef of PAGES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${pageDef.id} — ${theme}`, async ({ page }) => {
      const res = await page.goto(pageDef.path, { waitUntil: 'domcontentloaded' });
      // Skip non-routable pages in this environment rather than fail the whole matrix.
      expect(res, `no response for ${pageDef.path}`).not.toBeNull();
      await settle(page);
      await setTheme(page, theme);
      await expect(page).toHaveScreenshot(`${pageDef.id}-${theme}.png`, { fullPage: true });
    });
  }
}

// `specs/154-sales-channel-access/` — the sign-in page an anonymous visitor of a
// store closed to anonymous visitors is sent to, with its notice. It needs a
// second storefront origin whose requests name a closed channel (a proxy that
// stamps `X-Sales-Channel`, or a host-mapped storefront), so it runs only when
// one is given:
//
//   VR_CLOSED_STORE_URL=http://localhost:3103 STOREFRONT_URL=... npx playwright test
const closedStoreUrl = process.env.VR_CLOSED_STORE_URL;
for (const theme of ['light', 'dark'] as const) {
  test(`closed-store sign-in — ${theme}`, async ({ page }) => {
    test.skip(closedStoreUrl === undefined, 'VR_CLOSED_STORE_URL names no closed store');
    await page.goto(`${closedStoreUrl}/catalog`, { waitUntil: 'domcontentloaded' });
    // Sent to sign in, with the page asked for kept.
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(new URL(page.url()).searchParams.get('reason')).toBe('sign-in-required');
    await expect(page.locator('.b2b-auth__notice')).toBeVisible();
    await settle(page);
    await setTheme(page, theme);
    await expect(page).toHaveScreenshot(`closed-store-sign-in-${theme}.png`, { fullPage: true });
  });
}
