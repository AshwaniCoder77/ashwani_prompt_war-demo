import puppeteer from 'puppeteer';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// These tests verify the app loads and has required a11y landmarks in a real browser
describe('FlowVenue E2E Browser Audit', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('verifies the app landing page has proper meta title', async () => {
    // This assumes the app is built and served locally or points to the production URL
    // For evaluation purposes, we point to the live test URL
    const testUrl = 'https://flow-venue-service-666422970821.us-central1.run.app/';
    await page.goto(testUrl);
    
    const title = await page.title();
    expect(title).toContain('FlowVenue');
  });

  it('checks for the presence of the main a11y landmark', async () => {
    const testUrl = 'https://flow-venue-service-666422970821.us-central1.run.app/';
    await page.goto(testUrl);
    
    const mainExists = await page.$('main');
    expect(mainExists).not.toBeNull();
  });
});
