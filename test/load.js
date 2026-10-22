// js/*.js（window に載せる作り）を node で読むための小さな入れ物
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadScripts(files, extra) {
  const window = Object.assign({ console, URL, crypto: globalThis.crypto, TextEncoder }, extra || {});
  window.window = window;
  const context = vm.createContext(window);
  files.forEach((file) => {
    const code = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    vm.runInContext(code, context, { filename: file });
  });
  return window;
}

module.exports = { loadScripts };
