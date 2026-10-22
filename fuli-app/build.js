const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const rootDir = path.resolve(__dirname, '..');
const appDir = __dirname;
const distDir = path.join(rootDir, 'dist');
const icnsPath = path.join(appDir, 'renderer', 'assets', 'Fuli.icns');
const icoPath = path.join(appDir, 'renderer', 'assets', 'Fuli.ico');
const packagerBin = path.join(appDir, 'node_modules', '@electron', 'packager', 'bin', 'electron-packager.mjs');

// Parse CLI flags (--platform=win32|darwin, --arch=x64|arm64)
const args = process.argv.slice(2);
let targetPlatform = process.platform;
let targetArch = process.arch;

for (const arg of args) {
  if (arg.startsWith('--platform=')) {
    targetPlatform = arg.split('=')[1];
  } else if (arg.startsWith('--arch=')) {
    targetArch = arg.split('=')[1];
  }
}

// Adjust arch defaults if needed (e.g. default win32 to x64)
if (targetPlatform === 'win32' && targetArch !== 'arm64') {
  targetArch = 'x64';
}

console.log(`⚡ Building Fuli Application for [Platform: ${targetPlatform}, Arch: ${targetArch}]...`);

if (targetPlatform === 'win32') {
  // ==========================================
  // Windows Build (win32)
  // ==========================================
  let iconFlag = '';
  if (fs.existsSync(icoPath)) {
    iconFlag = `--icon="${icoPath}"`;
  }

  const packCmd = `"${packagerBin}" "${appDir}" Fuli --platform=win32 --arch=${targetArch} ${iconFlag} --app-version=1.0.0 --overwrite --out="${distDir}"`;
  console.log(`Running: ${packCmd}`);
  execSync(packCmd, { stdio: 'inherit' });

  const winOutDir = path.join(distDir, `Fuli-win32-${targetArch}`);
  const resourcesPath = path.join(winOutDir, 'resources');

  // Copy .env into bundle resources
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath) && fs.existsSync(resourcesPath)) {
    fs.copyFileSync(envPath, path.join(resourcesPath, '.env'));
    console.log('✓ Copied .env credentials into Windows bundle resources');
  }

  // If currently running on Windows, setup Startup shortcut
  if (process.platform === 'win32') {
    const startupFolder = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const exePath = path.join(winOutDir, 'Fuli.exe');
    if (fs.existsSync(startupFolder) && fs.existsSync(exePath)) {
      try {
        const psShortcut = `
          $w = New-Object -ComObject WScript.Shell
          $s = $w.CreateShortcut('${path.join(startupFolder, 'Fuli.lnk').replace(/'/g, "''")}')
          $s.TargetPath = '${exePath.replace(/'/g, "''")}'
          $s.WorkingDirectory = '${winOutDir.replace(/'/g, "''")}'
          $s.Save()
        `.replace(/\n/g, ' ');
        execSync(`powershell -NoProfile -Command "${psShortcut}"`, { stdio: 'ignore' });
        console.log('✓ Created Windows Startup shortcut for auto-launch');
      } catch (e) {
        console.warn('Startup shortcut notice:', e.message);
      }
    }
  }

  console.log(`\n🎉 SUCCESS! Fuli Windows executable is ready.`);
  console.log(`Location: ${path.join(winOutDir, 'Fuli.exe')}`);

} else {
  // ==========================================
  // macOS Build (darwin)
  // ==========================================
  // Widevine-enabled Electron (castlabs) so Spotify can play inside Fuli. Zip lives in <repo>/.electron-zip
  const electronPkg = require(path.join(appDir, 'node_modules', 'electron', 'package.json'));
  const zipDir = path.join(rootDir, '.electron-zip');
  const castlabsFlags = String(electronPkg.version).includes('wvcus') && fs.existsSync(zipDir)
    ? `--electron-version="${electronPkg.version}" --electron-zip-dir="${zipDir}"` : '';
  const packCmd = `"${packagerBin}" "${appDir}" Fuli --platform=darwin --arch=${targetArch} ${castlabsFlags} --app-bundle-id=com.aareev.fuli --app-version=1.0.0 --overwrite --out="${distDir}"`;
  console.log(`Running: ${packCmd}`);
  execSync(packCmd, { stdio: 'inherit' });

  const bundlePath = path.join(distDir, `Fuli-darwin-${targetArch}`, 'Fuli.app');
  const resourcesPath = path.join(bundlePath, 'Contents', 'Resources');
  const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');

  // Copy Fuli.icns
  if (fs.existsSync(icnsPath) && fs.existsSync(resourcesPath)) {
    fs.copyFileSync(icnsPath, path.join(resourcesPath, 'Fuli.icns'));
  }

  // Copy .env into bundle Resources so it always has access to API keys
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath) && fs.existsSync(resourcesPath)) {
    fs.copyFileSync(envPath, path.join(resourcesPath, '.env'));
    console.log('✓ Copied .env credentials into application bundle');
  }

  // If running on macOS, configure Info.plist and install to /Applications
  if (process.platform === 'darwin') {
    try {
      execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName Fuli" "${plistPath}"`);
      execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Fuli" "${plistPath}"`);
      execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile Fuli.icns" "${plistPath}"`);
      execSync(`/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "${plistPath}" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "${plistPath}"`);
      console.log('✓ Set CFBundle metadata & LSUIElement: true in Info.plist');
    } catch (e) {
      console.warn('PlistBuddy update note:', e.message);
    }

    // castlabs VMP signature: lets Widevine (and so Spotify's in-app player) trust this build.
    // Needs a free EVS account — see README ("Play Spotify inside Fuli"). Skipped quietly if not set up.
    const evsPython = path.join(rootDir, '.evs-venv', 'bin', 'python');
    if (fs.existsSync(evsPython)) {
      try {
        execSync(`"${evsPython}" -m castlabs_evs.vmp -n sign-pkg "${path.dirname(bundlePath)}"`, { stdio: 'pipe', input: '' });
        console.log('✓ VMP-signed bundle (castlabs EVS)');
      } catch (e) {
        console.warn('VMP signing skipped — run `npm run evs:signup` once to enable in-app Spotify audio.');
      }
    }

    // Re-seal the bundle. We edit it after packaging (icon, .env, Info.plist) and VMP signing writes extra files, which
    // breaks the code signature; macOS then refuses to open the app normally. castlabs' order is: VMP sign, then codesign.
    try {
      execSync(`codesign --force --deep --sign - "${bundlePath}"`, { stdio: 'pipe' });
      console.log('✓ Re-sealed app bundle (codesign)');
    } catch (e) {
      console.warn('codesign step failed:', String(e.stderr || e.message).split('\n')[0]);
    }

    const appDest = '/Applications/Fuli.app';
    try {
      if (fs.existsSync(appDest)) {
        execSync(`rm -rf "${appDest}"`);
      }
      execSync(`cp -R "${bundlePath}" "${appDest}"`);
      execSync(`touch "${appDest}"`);
      console.log('✓ Installed Fuli.app directly to /Applications/Fuli.app');
    } catch (e) {
      console.warn('Could not copy to /Applications:', e.message);
    }

    // Older builds installed a LaunchAgent with KeepAlive, which relaunched Fuli right after "Quit Fuli" and
    // started it at login no matter what the menu said. Starting at login is now the menu's own checkbox.
    const oldAgent = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.aareev.fuli.plist');
    if (fs.existsSync(oldAgent)) {
      try { execSync(`launchctl bootout gui/$(id -u) "${oldAgent}" 2>/dev/null || launchctl unload "${oldAgent}" 2>/dev/null || true`); } catch {}
      try { fs.unlinkSync(oldAgent); console.log('✓ Removed old Fuli LaunchAgent (Quit now really quits)'); } catch {}
    }

    try {
      execSync(`touch "${bundlePath}"`);
    } catch {}
  }

  console.log('\n🎉 SUCCESS! Fuli macOS bundle is ready.');
  console.log(`Location: ${bundlePath}`);
}
