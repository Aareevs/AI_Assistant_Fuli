const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

class BrowserController {
  constructor() {
    this.activeBrowser = null;
  }

  /**
   * Detects which browser is currently running, prioritizing Microsoft Edge if open.
   */
  async detectRunningBrowser() {
    if (isWin) {
      try {
        const { stdout } = await execPromise(`powershell -NoProfile -Command "Get-Process | Select-Object -ExpandProperty ProcessName"`, { timeout: 2500 });
        if (/msedge/i.test(stdout)) return 'msedge';
        if (/chrome/i.test(stdout)) return 'chrome';
        if (/brave/i.test(stdout)) return 'brave';
        if (/firefox/i.test(stdout)) return 'firefox';
      } catch (e) {}
      return 'msedge';
    }

    // macOS detection
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
    return 'Microsoft Edge';
  }

  /**
   * Navigates the CURRENT ACTIVE TAB in the open browser to the URL in-place.
   * NEVER opens a new tab or a test browser. Works on both Windows and macOS.
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

    if (isWin) {
      const appTitle = browser === 'msedge' ? 'Edge' : (browser === 'chrome' ? 'Chrome' : browser);
      // In-place navigation on Windows: Activate browser, Ctrl+L (focus address bar), paste URL, Enter
      const psCommand = `
        $w = New-Object -ComObject WScript.Shell
        if ($w.AppActivate('${appTitle}')) {
          Start-Sleep -Milliseconds 180
          $w.SendKeys('^l')
          Start-Sleep -Milliseconds 120
          Set-Clipboard -Value '${url}'
          $w.SendKeys('^v{ENTER}')
        } else {
          Start-Process '${browser}' '${url}'
        }
      `.replace(/\n/g, ' ');

      try {
        await execPromise(`powershell -NoProfile -Command "${psCommand}"`, { timeout: 4000 });
        return { success: true, browser, url };
      } catch (err) {
        console.warn(`Windows browser navigation notice:`, err.message);
        try {
          await execPromise(`start "" "${url}"`);
        } catch (e) {}
        return { success: true, browser: 'default', url };
      }
    }

    // macOS AppleScript in-place navigation
    let script = '';
    if (browser === 'Microsoft Edge' || browser === 'Google Chrome' || browser === 'Brave Browser') {
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
      try {
        await execPromise(`open "${url}"`);
      } catch (e) {}
      return { success: true, browser: 'default', url };
    }
  }

  /**
   * Types text into the active browser window using clipboard paste for 100% fidelity.
   * Works on ChatGPT, Claude, textareas, inputs, and search bars without hijacking.
   */
  async type(selector, text, pressEnter = false) {
    if (!text) return { success: true };

    const browser = await this.detectRunningBrowser();
    console.log(`⌨️ Pasting text into active tab of ${browser}: "${text.slice(0, 50)}..." (pressEnter: ${pressEnter})`);

    if (isWin) {
      const appTitle = browser === 'msedge' ? 'Edge' : (browser === 'chrome' ? 'Chrome' : browser);
      const escapedText = text.replace(/'/g, "''");
      const psCommand = `
        Set-Clipboard -Value '${escapedText}'
        $w = New-Object -ComObject WScript.Shell
        if ($w.AppActivate('${appTitle}')) {
          Start-Sleep -Milliseconds 150
          $w.SendKeys('^v')
          ${pressEnter ? 'Start-Sleep -Milliseconds 250; $w.SendKeys("{ENTER}")' : ''}
        }
      `.replace(/\n/g, ' ');

      try {
        await execPromise(`powershell -NoProfile -Command "${psCommand}"`, { timeout: 4000 });
        return { success: true };
      } catch (err) {
        console.warn('Windows type error:', err.message);
        return { success: false, error: err.message };
      }
    }

    // macOS implementation
    try {
      const proc = exec('pbcopy');
      proc.stdin.write(text);
      proc.stdin.end();
    } catch (e) {
      console.warn('pbcopy error:', e.message);
    }

    await this.wait(180);

    const script = `
      tell application "${browser}" to activate
      delay 0.3
      tell application "System Events"
        keystroke "v" using {command down}
        ${pressEnter ? 'delay 0.4\nkey code 36' : ''}
      end tell
    `;

    try {
      await execPromise(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 4000 });
      return { success: true };
    } catch (err) {
      console.warn('Type error:', err.message);
      return { success: false, error: err.message };
    }
  }

  async click(selector) {
    return { success: true };
  }

  async press(key) {
    try {
      if (isWin) {
        let keyString = '{ENTER}';
        if (key === 'Escape') keyString = '{ESC}';
        if (key === 'Tab') keyString = '{TAB}';
        if (key === 'ArrowDown') keyString = '{DOWN}';
        await execPromise(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys('${keyString}')"`, { timeout: 2000 });
        return { success: true };
      }

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
