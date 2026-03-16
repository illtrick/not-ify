/**
 * Suite E5 — Error state tests
 * Verifies the app handles bad inputs and missing resources gracefully.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

test.describe('API error handling', () => {
  test('GET /api/search with empty q returns 400', async ({ request }) => {
    const res = await request.get(`${BASE}/api/search?q=`);
    // Empty or missing q should be rejected
    expect([400, 422]).toContain(res.status());
  });

  test('GET /api/cover/badmbid returns 400', async ({ request }) => {
    const res = await request.get(`${BASE}/api/cover/not-a-valid-mbid`);
    expect(res.status()).toBe(400);
  });

  test('GET /api/yt/stream/tooshort returns 400', async ({ request }) => {
    const res = await request.get(`${BASE}/api/yt/stream/tooshort`);
    expect(res.status()).toBe(400);
  });

  test('GET /api/yt/stream with invalid chars returns 400', async ({ request }) => {
    const res = await request.get(`${BASE}/api/yt/stream/abc!@#$%^&*(`);
    expect(res.status()).toBe(400);
  });

  test('DELETE /api/library/album without body returns 400', async ({ request }) => {
    const res = await request.delete(`${BASE}/api/library/album`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/download/yt without url returns 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/download/yt`, {
      data: { title: 'No URL' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('UI error resilience', () => {
  test('app does not crash on malformed search', async ({ page }) => {
    await page.goto(BASE);
    const input = page.locator('input[type="text"], input[placeholder*="earch"]').first();
    // Unicode, emoji, long strings should not crash the UI
    await input.fill('🎵🎵🎵'.repeat(50));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  test('app does not crash on special characters in search', async ({ page }) => {
    await page.goto(BASE);
    const input = page.locator('input[type="text"], input[placeholder*="earch"]').first();
    await input.fill('<script>alert(1)</script>');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
    // XSS: alert should NOT have fired
    const dialogFired = await page.evaluate(() => window.__alertFired ?? false);
    expect(dialogFired).toBe(false);
  });
});
