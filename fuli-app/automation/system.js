const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');
const execPromise = util.promisify(exec);

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

class SystemController {
  async openApp(appName) {
    const cleanName = appName.replace(/["\\]/g, '').trim();
    try {
      if (isWin) {
        await execPromise(`powershell -NoProfile -Command "Start-Process '${cleanName}'"`);
      } else {
        await execPromise(`open -a "${cleanName}"`);
      }
      return { success: true, message: `Opened application: ${cleanName}` };
    } catch (err) {
      // Secondary fallback on Windows
      if (isWin) {
        try {
          await execPromise(`start "" "${cleanName}"`);
          return { success: true, message: `Opened application: ${cleanName}` };
        } catch (e) {}
      }
      throw new Error(`Failed to launch ${cleanName}: ${err.message}`);
    }
  }

  async openUrl(url) {
    try {
      if (isWin) {
        await execPromise(`powershell -NoProfile -Command "Start-Process '${url}'"`);
      } else {
        await execPromise(`open "${url}"`);
      }
      return { success: true, message: `Opened URL: ${url}` };
    } catch (err) {
      throw new Error(`Failed to open URL ${url}: ${err.message}`);
    }
  }

  async quitApp(appName) {
    const cleanName = appName.replace(/["\\]/g, '').trim();
    try {
      if (isWin) {
        // Strip .exe if provided and kill matching process
        const baseName = cleanName.replace(/\.exe$/i, '');
        await execPromise(`powershell -NoProfile -Command "Get-Process -Name '*${baseName}*' -ErrorAction SilentlyContinue | Stop-Process -Force"`);
      } else {
        await execPromise(`osascript -e 'quit app "${cleanName}"'`);
      }
      return { success: true, message: `Closed application: ${cleanName}` };
    } catch (err) {
      throw new Error(`Failed to quit ${cleanName}: ${err.message}`);
    }
  }

  async setVolume(percent) {
    const level = Math.max(0, Math.min(100, parseInt(percent, 10) || 50));
    try {
      if (isWin) {
        const volFraction = (level / 100).toFixed(2);
        const psScript = `
          $vol = ${volFraction}
          Add-Type -TypeDefinition @"
          using System.Runtime.InteropServices;
          [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
          public interface IAudioEndpointVolume {
              int f1(); int f2(); int f3(); int f4();
              int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
              int f6();
              int GetMasterVolumeLevelScalar(out float pfLevel);
          }
          [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
          public interface IMMDevice {
              int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
          }
          [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
          public interface IMMDeviceEnumerator {
              int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
          }
          [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumeratorComObject { }
          public class AudioHelper {
              public static void SetVolume(float level) {
                  var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
                  IMMDevice dev = null;
                  enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
                  var epvId = typeof(IAudioEndpointVolume).GUID;
                  IAudioEndpointVolume epv = null;
                  dev.Activate(ref epvId, 23, 0, out epv);
                  epv.SetMasterVolumeLevelScalar(level, System.Guid.Empty);
              }
          }
"@
          [AudioHelper]::SetVolume($vol)
        `.replace(/\n/g, ' ');
        await execPromise(`powershell -NoProfile -Command "${psScript}"`);
      } else {
        await execPromise(`osascript -e "set volume output volume ${level}"`);
      }
      return { success: true, message: `Volume set to ${level}%` };
    } catch (err) {
      throw new Error(`Failed to set volume: ${err.message}`);
    }
  }

  async mediaControl(action) {
    const act = (action || '').toLowerCase().trim();
    try {
      if (isWin) {
        // Universal Windows media keys: 179 = Play/Pause, 176 = Next, 177 = Previous
        let keyCode = 179;
        if (act === 'next') keyCode = 176;
        else if (act === 'previous' || act === 'prev') keyCode = 177;
        await execPromise(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]${keyCode})"`);
        return { success: true, message: `Media action performed: ${act}` };
      }

      // macOS AppleScript
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
        await execPromise(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        return { success: true, message: `Media action performed: ${act}` };
      }
      return { success: false, message: `Unknown media action: ${act}` };
    } catch (err) {
      throw new Error(`Failed to execute media control: ${err.message}`);
    }
  }

  async openPath(targetPath) {
    const cleanPath = targetPath.replace(/["\\]/g, '').trim();
    try {
      if (isWin) {
        await execPromise(`powershell -NoProfile -Command "Start-Process '${cleanPath}'"`);
      } else {
        await execPromise(`open "${cleanPath}"`);
      }
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
    const dest = path.join(os.tmpdir(), `fuli_screenshot_${ts}.png`);
    try {
      if (isWin) {
        const psCommand = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); $bmp.Save('${dest.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose();`;
        await execPromise(`powershell -NoProfile -Command "${psCommand}"`);
      } else {
        await execPromise(`screencapture -x "${dest}"`);
      }
      return { success: true, path: dest, message: `Screenshot saved to ${dest}` };
    } catch (err) {
      throw new Error(`Failed to capture screen: ${err.message}`);
    }
  }

  async speak(text) {
    if (!text || !text.trim()) return;
    const cleanText = text.replace(/["\\]/g, ' ').replace(/\n/g, ' ').trim();
    const tmpAudio = path.join(os.tmpdir(), `fuli_speech_${Date.now()}.mp3`);
    
    // First try free Microsoft Edge neural female voice (en-US-AriaNeural)
    try {
      if (isWin) {
        await execPromise(`uv run edge-tts --voice en-US-AriaNeural --text "${cleanText}" --write-media "${tmpAudio}"`, { timeout: 10000 });
        if (fs.existsSync(tmpAudio)) {
          const playCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName presentationCore; $p = New-Object system.windows.media.mediaplayer; $p.open('${tmpAudio.replace(/\\/g, '\\\\')}'); $p.Play(); Start-Sleep -Seconds 1; while($p.Position -lt $p.NaturalDuration.TimeSpan){ Start-Sleep -Milliseconds 100 }"`;
          await execPromise(playCmd, { timeout: 15000 });
          try { fs.unlinkSync(tmpAudio); } catch (e) {}
        }
      } else {
        await execPromise(`uv run edge-tts --voice en-US-AriaNeural --text "${cleanText}" --write-media "${tmpAudio}" && afplay "${tmpAudio}" && rm -f "${tmpAudio}"`, {
          timeout: 10000
        });
      }
      return;
    } catch (e) {
      // Offline native system TTS fallback
      try {
        if (isWin) {
          // Native Windows SAPI speech synthesis
          await execPromise(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${cleanText}')"`, { timeout: 6000 });
        } else {
          // Native macOS Samantha
          await execPromise(`say -v Samantha "${cleanText}"`, { timeout: 6000 });
        }
      } catch {}
    }
  }
}

const systemController = new SystemController();
module.exports = { systemController, SystemController };
