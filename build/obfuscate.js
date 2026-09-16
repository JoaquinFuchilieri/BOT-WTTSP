const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

console.log('====================================================');
console.log('    F-DISPATCH ULTRA-HARDENED OBFUSCATION SUITE     ');
console.log('====================================================');

// 1. OBFUSCATE MAIN PROCESS FILES
const mainSrcDir = path.join(__dirname, '..', 'src', 'main');
const mainOutDir = path.join(__dirname, '..', 'dist', 'obf');
if (!fs.existsSync(mainOutDir)) fs.mkdirSync(mainOutDir, { recursive: true });

const mainFiles = fs.readdirSync(mainSrcDir).filter(f => f.endsWith('.js'));
console.log(`\n[Main Process] Obfuscating ${mainFiles.length} files (Node target)...`);

for (const file of mainFiles) {
  const code = fs.readFileSync(path.join(mainSrcDir, file), 'utf8');
  console.log(`  -> Obfuscating main/${file}...`);
  const result = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1.0,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    numbersToExpressions: true,
    simplify: false,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 1.0,
    splitStrings: true,
    splitStringsChunkLength: 8,
    transformObjectKeys: true,
    target: 'node'
  });
  fs.writeFileSync(path.join(mainOutDir, file), result.getObfuscatedCode(), 'utf8');
}
console.log('✓ Main process files obfuscated at dist/obf');

// 2. OBFUSCATE PRELOAD SCRIPT
const preloadSrc = path.join(__dirname, '..', 'src', 'preload', 'index.js');
const preloadOutDir = path.join(__dirname, '..', 'dist', 'preload');
if (!fs.existsSync(preloadOutDir)) fs.mkdirSync(preloadOutDir, { recursive: true });

if (fs.existsSync(preloadSrc)) {
  console.log(`\n[Preload] Obfuscating preload/index.js...`);
  const preloadCode = fs.readFileSync(preloadSrc, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(preloadCode, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.85,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.3,
    selfDefending: true,
    debugProtection: true,
    debugProtectionInterval: 2500,
    numbersToExpressions: true,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.9,
    splitStrings: true,
    splitStringsChunkLength: 8,
    transformObjectKeys: true,
    target: 'node'
  });
  fs.writeFileSync(path.join(preloadOutDir, 'index.js'), result.getObfuscatedCode(), 'utf8');
  console.log('✓ Preload script obfuscated at dist/preload/index.js');
}

// 3. PREPARE & OBFUSCATE DESKTOP RENDERER
const rendererSrcDir = path.join(__dirname, '..', 'src', 'renderer');
const rendererOutDir = path.join(__dirname, '..', 'dist', 'renderer');
if (!fs.existsSync(rendererOutDir)) fs.mkdirSync(rendererOutDir, { recursive: true });

console.log(`\n[Renderer] Preparing production renderer bundle at dist/renderer...`);

// Copy static assets
['assets', 'css'].forEach(folder => {
  const src = path.join(rendererSrcDir, folder);
  const dest = path.join(rendererOutDir, folder);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`  -> Copied ${folder}/`);
  }
});

// Copy icon and HTML files
const rendererFiles = fs.readdirSync(rendererSrcDir);
rendererFiles.filter(f => f.endsWith('.html') || f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.ico')).forEach(file => {
  fs.copyFileSync(path.join(rendererSrcDir, file), path.join(rendererOutDir, file));
  console.log(`  -> Copied ${file}`);
});

// Obfuscate renderer JS files
const rendererJsSrc = path.join(rendererSrcDir, 'js');
const rendererJsOut = path.join(rendererOutDir, 'js');
if (!fs.existsSync(rendererJsOut)) fs.mkdirSync(rendererJsOut, { recursive: true });

if (fs.existsSync(rendererJsSrc)) {
  const jsFiles = fs.readdirSync(rendererJsSrc).filter(f => f.endsWith('.js'));
  for (const file of jsFiles) {
    if (file === 'lucide.min.js') {
      // Keep vendor icon library as-is
      fs.copyFileSync(path.join(rendererJsSrc, file), path.join(rendererJsOut, file));
      console.log(`  -> Copied vendor ${file}`);
      continue;
    }

    console.log(`  -> Obfuscating renderer/js/${file} (Browser target + Self-Defending)...`);
    const code = fs.readFileSync(path.join(rendererJsSrc, file), 'utf8');
    const result = JavaScriptObfuscator.obfuscate(code, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.8,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.25,
      selfDefending: true,
      debugProtection: true,
      debugProtectionInterval: 2500,
      disableConsoleOutput: true,
      numbersToExpressions: true,
      stringArray: true,
      stringArrayEncoding: ['rc4'],
      stringArrayThreshold: 0.85,
      splitStrings: true,
      splitStringsChunkLength: 8,
      transformObjectKeys: true,
      target: 'browser'
    });
    fs.writeFileSync(path.join(rendererJsOut, file), result.getObfuscatedCode(), 'utf8');
  }
  console.log('✓ Desktop renderer protected at dist/renderer/js/');
}

// 4. OBFUSCATE WEB SAAS FRONTEND
const webAppJsPath = path.join(__dirname, '..', 'BOT WTTSP-SERVER', 'frontend', 'js', 'app.js');
const webAppMinJsPath = path.join(__dirname, '..', 'BOT WTTSP-SERVER', 'frontend', 'js', 'app.min.js');

if (fs.existsSync(webAppJsPath)) {
  console.log(`\n[Web SaaS] Obfuscating BOT WTTSP-SERVER/frontend/js/app.js...`);
  const webCode = fs.readFileSync(webAppJsPath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(webCode, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    selfDefending: true,
    debugProtection: true,
    debugProtectionInterval: 3000,
    disableConsoleOutput: true,
    numbersToExpressions: true,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.8,
    splitStrings: true,
    splitStringsChunkLength: 10,
    transformObjectKeys: true,
    target: 'browser'
  });
  fs.writeFileSync(webAppMinJsPath, result.getObfuscatedCode(), 'utf8');
  console.log('✓ Web SaaS frontend protected at frontend/js/app.min.js');
}

console.log('\n====================================================');
console.log('    ✓ ALL COMPONENTS OBFUSCATED & HARDENED!         ');
console.log('====================================================\n');
