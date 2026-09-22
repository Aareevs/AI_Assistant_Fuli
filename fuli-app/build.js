const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const rootDir = path.resolve(__dirname, '..');
const appDir = __dirname;
const distDir = path.join(rootDir, 'dist');
const icnsPath = path.join(appDir, 'renderer', 'assets', 'Fuli.icns');
const packagerBin = path.join(appDir, 'node_modules', '@electron', 'packager', 'bin', 'electron-packager.mjs');

console.log('⚡ Building Fuli macOS Application...');

// 1. Run electron-packager
execSync(`"${packagerBin}" "${appDir}" Fuli --platform=darwin --arch=arm64 --app-bundle-id=com.aareev.fuli --app-version=1.0.0 --overwrite --out="${distDir}"`, {
  stdio: 'inherit'
});

const bundlePath = path.join(distDir, 'Fuli-darwin-arm64', 'Fuli.app');
const resourcesPath = path.join(bundlePath, 'Contents', 'Resources');
const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');

// 2. Copy Fuli.icns
fs.copyFileSync(icnsPath, path.join(resourcesPath, 'Fuli.icns'));

// 3. Copy .env into bundle Resources so it always has access to API keys
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  fs.copyFileSync(envPath, path.join(resourcesPath, '.env'));
  console.log('✓ Copied .env credentials into application bundle');
}

// 4. Update Info.plist with PlistBuddy
try {
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName Fuli" "${plistPath}"`);
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Fuli" "${plistPath}"`);
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile Fuli.icns" "${plistPath}"`);
  console.log('✓ Set CFBundle metadata in Info.plist');
} catch (e) {
  console.warn('PlistBuddy update note:', e.message);
}

// 5. Install / copy to /Applications
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

// 6. Register persistent macOS LaunchAgent so Fuli is always running like Spotlight
const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const launchAgentPlist = path.join(launchAgentsDir, 'com.aareev.fuli.plist');
try {
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aareev.fuli</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Fuli.app/Contents/MacOS/Fuli</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>/tmp/fuli_app.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/fuli_app.err</string>
</dict>
</plist>`;
  fs.writeFileSync(launchAgentPlist, plistXml);
  try {
    execSync(`launchctl unload "${launchAgentPlist}" 2>/dev/null || true`);
    execSync(`launchctl load "${launchAgentPlist}"`);
  } catch {}
  console.log('✓ Registered macOS LaunchAgent (KeepAlive: true, RunAtLoad: true)');
} catch (e) {
  console.warn('LaunchAgent registration notice:', e.message);
}

// Refresh Finder / Dock icon cache for the app
try {
  execSync(`touch "${bundlePath}"`);
} catch {}

console.log('\n🎉 SUCCESS! Fuli.app is ready.');
console.log('Location: /Applications/Fuli.app (and dist/Fuli-darwin-arm64/Fuli.app)');
