const { chromium } = require('playwright');

class BrowserController {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async init(options = {}) {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: options.headless !== undefined ? options.headless : false,
        slowMo: 60, // Human-like pace so the user can watch the action
        args: [
          '--start-maximized',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      this.context = await this.browser.newContext({
        viewport: null, // use full window
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });

      this.page = await this.context.newPage();
    }
    return this.page;
  }

  async highlightElement(selector) {
    if (!this.page) return;
    try {
      await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.style.outline = '3px solid #00f0ff';
          el.style.boxShadow = '0 0 15px rgba(0, 240, 255, 0.7)';
          setTimeout(() => {
            el.style.outline = '';
            el.style.boxShadow = '';
          }, 1500);
        }
      }, selector);
    } catch (e) {
      // Non-fatal if highlighting fails
    }
  }

  async navigate(url) {
    await this.init();
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { success: true, url: this.page.url() };
  }

  async type(selector, text, pressEnter = false) {
    await this.init();
    // Try multiple selectors if separated by comma
    const locator = this.page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    
    await this.highlightElement(selector);
    await locator.click();
    await locator.fill(''); // clear existing
    await locator.type(text, { delay: 40 }); // realistic human typing delay

    if (pressEnter) {
      await this.page.keyboard.press('Enter');
    }
    return { success: true };
  }

  async click(selector) {
    await this.init();
    const locator = this.page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    await this.highlightElement(selector);
    await locator.click();
    return { success: true };
  }

  async press(key) {
    if (!this.page) await this.init();
    await this.page.keyboard.press(key);
    return { success: true };
  }

  async wait(durationMs = 2000) {
    if (this.page) {
      await this.page.waitForTimeout(durationMs);
    } else {
      await new Promise(r => setTimeout(r, durationMs));
    }
    return { success: true };
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {}
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

const browserController = new BrowserController();
module.exports = { browserController, BrowserController };
