const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const filesToObfuscate = ['main.js', 'preload.js', 'schema.js'];
const backupDir = path.join(__dirname, '.backup-src');

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 10,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  target: 'node',
};

if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);

for (const file of filesToObfuscate) {
  const src = path.join(__dirname, file);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(backupDir, file));
  console.log(`Backup ${file}`);
  const code = fs.readFileSync(src, 'utf-8');
  console.log(`Obfuscating ${file}...`);
  const result = JavaScriptObfuscator.obfuscate(code, options);
  fs.writeFileSync(src, result.getObfuscatedCode());
  console.log(`  → ${file} obfuscated in-place`);
}

console.log('\nRunning electron-builder...');
try {
  const platform = process.argv.includes('--win') ? '--win' : process.argv.includes('--all') ? '--mac --win' : '--mac';
  execSync(`npx electron-builder ${platform}`, { cwd: __dirname, stdio: 'inherit' });
  console.log('\n✅ Build complete!');
} catch (e) {
  console.error('\n❌ Build failed');
} finally {
  for (const file of filesToObfuscate) {
    const backup = path.join(backupDir, file);
    if (fs.existsSync(backup)) {
      fs.copyFileSync(backup, path.join(__dirname, file));
    }
  }
  fs.rmSync(backupDir, { recursive: true, force: true });
  console.log('Sources restored from backup.');
}
