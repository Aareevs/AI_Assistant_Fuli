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

  async quitApp(appName) {
    const cleanName = appName.replace(/["\\]/g, '');
    try {
      await execPromise(`osascript -e 'quit app "${cleanName}"'`);
      return { success: true, message: `Closed application: ${cleanName}` };
    } catch (err) {
      throw new Error(`Failed to quit ${cleanName}: ${err.message}`);
    }
  }

  async setVolume(percent) {
    const level = Math.max(0, Math.min(100, parseInt(percent, 10) || 50));
    try {
      await execPromise(`osascript -e "set volume output volume ${level}"`);
      return { success: true, message: `Volume set to ${level}%` };
    } catch (err) {
      throw new Error(`Failed to set volume: ${err.message}`);
    }
  }

  async mediaControl(action) {
    const act = (action || '').toLowerCase().trim();
    let script = '';
    if (act === 'play' || act === 'pause' || act === 'toggle') {
      script = `
        tell application "System Events"
          if exists (process "Spotify") then
            tell application "Spotify" to playpause
          else if exists (process "Music") then
            tell application "Music" to playpause
          end if
        end tell`;
    } else if (act === 'next') {
      script = `
        tell application "System Events"
          if exists (process "Spotify") then
            tell application "Spotify" to next track
          else if exists (process "Music") then
            tell application "Music" to next track
          end if
        end tell`;
    } else if (act === 'previous' || act === 'prev') {
      script = `
        tell application "System Events"
          if exists (process "Spotify") then
            tell application "Spotify" to previous track
          else if exists (process "Music") then
            tell application "Music" to previous track
          end if
        end tell`;
    }

    if (script) {
      try {
        await execPromise(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        return { success: true, message: `Media action performed: ${act}` };
      } catch (err) {
        throw new Error(`Failed to execute media control: ${err.message}`);
      }
    }
    return { success: false, message: `Unknown media action: ${act}` };
  }

  async openPath(targetPath) {
    try {
      await execPromise(`open "${targetPath.replace(/"/g, '')}"`);
      return { success: true, message: `Opened ${targetPath}` };
    } catch (err) {
      throw new Error(`Failed to open path: ${err.message}`);
    }
  }

  async runTerminalCommand(command) {
    try {
      const { stdout, stderr } = await execPromise(command, { maxBuffer: 1024 * 1024 });
      return { success: true, output: (stdout || stderr).trim() };
    } catch (err) {
      throw new Error(`Command failed: ${err.message}`);
    }
  }

  async takeScreenshot() {
    const ts = Date.now();
    const dest = `/tmp/fuli_screenshot_${ts}.png`;
    try {
      await execPromise(`screencapture -x "${dest}"`);
      return { success: true, path: dest, message: `Screenshot saved to ${dest}` };
    } catch (err) {
      throw new Error(`Failed to capture screen: ${err.message}`);
    }
  }

  async speak(text) {
    if (!text || !text.trim()) return;
    const cleanText = text.replace(/["\\]/g, ' ').replace(/\n/g, ' ').trim();
    
    // First try free Microsoft Edge neural female voice (en-US-AriaNeural)
    const tmpAudio = `/tmp/fuli_speech_${Date.now()}.mp3`;
    try {
      await execPromise(`uv run edge-tts --voice en-US-AriaNeural --text "${cleanText}" --write-media "${tmpAudio}" && afplay "${tmpAudio}" && rm -f "${tmpAudio}"`, {
        timeout: 10000
      });
      return;
    } catch (e) {
      // Fallback to local macOS natural female voice Samantha
      try {
        await execPromise(`say -v Samantha "${cleanText}"`);
      } catch {}
    }
  }
}

const systemController = new SystemController();
module.exports = { systemController, SystemController };
