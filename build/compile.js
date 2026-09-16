const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');

const obfDir = path.join(__dirname, '..', 'dist', 'obf');
const compiledDir = path.join(__dirname, '..', 'dist', 'compiled');

if (!fs.existsSync(compiledDir)) {
  fs.mkdirSync(compiledDir, { recursive: true });
}

if (!fs.existsSync(obfDir)) {
  console.error('[Bytenode] Obfuscated directory does not exist. Run obfuscate.js first.');
  process.exit(1);
}

const files = fs.readdirSync(obfDir).filter(f => f.endsWith('.js'));
console.log(`[Bytenode] Compiling ${files.length} files to V8 bytecode (.jsc)...`);

for (const file of files) {
  const srcFile = path.join(obfDir, file);
  const targetFile = path.join(compiledDir, file.replace(/\.js$/, '.jsc'));

  console.log(`[Bytenode] Compiling ${file} -> ${path.basename(targetFile)}`);
  try {
    bytenode.compileFile({
      filename: srcFile,
      output: targetFile,
      compileAsModule: true
    });
  } catch (err) {
    console.error(`[Bytenode] Error compiling ${file}:`, err);
    process.exit(1);
  }
}

console.log('[Bytenode] All core files compiled to V8 bytecode successfully!');
