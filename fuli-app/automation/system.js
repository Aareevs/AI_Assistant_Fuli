const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class SystemController {
  async openApp(appName) {
    // Sanitize app name to avoid command injection
    const cleanName = appName.replace(/["\\]/g, '');
    try {
      await execPromise(`open -a "${cleanName}"`);
      return { success: true, message: `Opened application: ${cleanName}` };
    } catch (err) {
      throw new Error(`Failed to launch ${cleanName}: ${err.message}`);
    }
  }

  async openUrl(url) {
    try {
      await execPromise(`open "${url}"`);
      return { success: true, message: `Opened URL: ${url}` };
    } catch (err) {
      throw new Error(`Failed to open URL ${url}: ${err.message}`);
    }
  }

  async runAppleScript(script) {
    try {
      const { stdout } = await execPromise(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      return { success: true, output: stdout.trim() };
    } catch (err) {
      throw new Error(`AppleScript error: ${err.message}`);
    }
  }

  async speak(text) {
    try {
      // Optional subtle voice confirmation via macOS built-in TTS
      const clean = text.replace(/["\\]/g, '');
      await execPromise(`say -v Samantha "${clean}"`);
    } catch (e) {
      // Non-fatal
    }
  }
}

const systemController = new SystemController();
module.exports = { systemController, SystemController };
