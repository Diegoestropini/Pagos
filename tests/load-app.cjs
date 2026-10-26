'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
module.exports = function loadApp(entry = 'app.js', beforeListeners = false) {
  const storage = new Map();
  const context = vm.createContext({
    document: { getElementById() { return {}; }, querySelector() { return {}; } },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    crypto: require('node:crypto').webcrypto,
    console: { error() {}, warn() {}, log() {} },
  });
  let source = fs.readFileSync(path.join(__dirname, '..', entry), 'utf8').replace(/\r\n/g, '\n');
  if (beforeListeners) {
    const marker = '\nsettingsForm.addEventListener(';
    assert.equal(source.split(marker).length, 2, 'App bootstrap boundary changed; update this isolated harness');
    source = source.slice(0, source.indexOf(marker));
  } else {
    assert.equal((source.match(/^initialize\(\);$/gm) || []).length, 1, 'App bootstrap changed; update this isolated harness');
    source = source.replace(/^initialize\(\);$/m, '');
  }
  // Evaluate the real production functions without starting rendering or event handlers.
  vm.runInContext(source, context, { filename: entry, timeout: 2000 });
  const run = code => vm.runInContext(code, context, { timeout: 2000 });
  return { storage, run, put: (key, value) => { context[key] = value; }, json: code => JSON.parse(JSON.stringify(run(code))) };
};
