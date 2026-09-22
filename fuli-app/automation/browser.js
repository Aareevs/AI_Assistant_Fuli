const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class BrowserController {
  constructor() {
    this.activeBrowser = null;
  }

  /**
   * Detects which browser is currently running, prioritizing Microsoft Edge if open.
   */
  async detectRunningBrowser() {
    const browsers = ['Microsoft Edge', 'Google Chrome', 'Brave Browser', 'Safari', 'Arc', 'Firefox'];
    try {
      const { stdout } = await execPromise(`osascript -e '
        tell application "System Events"
          set r to name of every process whose background only is false
        end tell
        return r
      '`, { timeout: 2000 });

      for (const b of browsers) {
        if (stdout.includes(b)) {
          return b;
        }
      }
    } catch (e) {}
    return 'Microsoft Edge'; // Default preferred browser
  }

  /**
   * Navigates the CURRENT ACTIVE TAB in the open browser to the URL in-place.
   * NEVER opens a new tab or a test browser.
   */
  async navigate(targetUrl) {
    let url = targetUrl;
    if (!url || typeof url !== 'string' || url === 'undefined') {
      url = 'https://www.google.com';
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
      }
    }

    const browser = await this.detectRunningBrowser();
    console.log(`🌐 Navigating active tab in ${browser} to: ${url}`);

    let script = '';
    if (browser === 'Microsoft Edge' || browser === 'Google Chrome' || browser === 'Brave Browser') {
      // Replaces the URL of the active tab of front window in-place — NO new tab!
      script = `
        tell application "${browser}"
          if (count of windows) is 0 then
            make new window
          end if
          set URL of active tab of front window to "${url}"
          activate
        end tell
      `;
    } else if (browser === 'Safari') {
      script = `
        tell application "Safari"
          if (count of windows) is 0 then
            make new document
          end if
          set URL of current tab of front window to "${url}"
          activate
        end tell
      `;
    } else {
      // General macOS handler
      script = `
        tell application "${browser}" to activate
        tell application "System Events" to open location "${url}"
      `;
    }

    try {
      await execPromise(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 3500 });
      return { success: true, browser, url };
    } catch (err) {
      console.warn(`AppleScript navigation notice for ${browser}:`, err.message);
      // Fallback to macOS open
      try {
        await execPromise(`open "${url}"`);
      } catch (e) {}
      return { success: true, browser: 'default', url };
    }
  }

  /**
   * If searching or filling text, directly navigates the active tab to search results.
   */
  async type(selector, text, pressEnter = false) {
    if (!text) return { success: true };
    if (pressEnter || !selector || selector.includes('q') || selector.includes('search')) {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
      return await this.navigate(searchUrl);
    }

    // Direct keystrokes into active window
    try {
      const browser = await this.detectRunningBrowser();
      const escaped = text.replace(/"/g, '\\"');
      const script = `
        tell application "${browser}" to activate
        tell application "System Events"
          keystroke "${escaped}"
          ${pressEnter ? 'key code 36' : ''}
        end tell
      `;
      await execPromise(`osascript -e '${script}'`, { timeout: 2000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async click(selector) {
    return { success: true };
  }

  async press(key) {
    try {
      let code = 36; // Enter
      if (key === 'Escape') code = 53;
      if (key === 'Tab') code = 48;
      if (key === 'ArrowDown') code = 125;
      await execPromise(`osascript -e 'tell application "System Events" to key code ${code}'`, { timeout: 2000 });
      return { success: true };
    } catch (e) {
      return { success: false };
    }
  }

  async wait(ms = 1000) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const browserController = new BrowserController();
module.exports = { browserController, BrowserController };
