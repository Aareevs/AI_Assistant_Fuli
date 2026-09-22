const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

// Refresh Finder / Dock icon cache for the app
try {
  execSync(`touch "${bundlePath}"`);
} catch {}

console.log('\n🎉 SUCCESS! Fuli.app is ready.');
console.log('Location: /Applications/Fuli.app (and dist/Fuli-darwin-arm64/Fuli.app)');
