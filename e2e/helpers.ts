/**
 * Shared helpers for e2e tests.
 * Sets up localStorage so the UserPicker is bypassed and the main app renders.
 */
import { Page, BrowserContext } from '@playwright/test';

const USER_KEY = 'notify-user';
const DEFAULT_USER = 'test-user';

/**
 * Call this before page.goto() to pre-seed localStorage with a user.
 * Playwright's addInitScript runs before any page scripts.
 */
export async function seedUser(context: BrowserContext, userId = DEFAULT_USER) {
  await context.addInitScript((args) => {
    localStorage.setItem(args.key, args.userId);
  }, { key: USER_KEY, userId });
}
