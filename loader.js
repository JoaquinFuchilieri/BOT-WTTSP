// =========================================================
// Bytenode Production Loader Stub for Electron
// Registers bytenode and loads the compiled V8 bytecode (.jsc)
// =========================================================

const path = require('path');
const bytenode = require('bytenode');

const compiledEntry = path.join(__dirname, 'dist', 'compiled', 'index.jsc');

console.log('[Bytenode Loader] Booting application from V8 bytecode...');
require(compiledEntry);
