#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const htmlFiles = [];
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) htmlFiles.push(full);
  }
}

walk(root);
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  if (!/\bid=["']cookieSettingsLink["']/i.test(html)) continue;
  const includesConsent = /<script\b(?=[^>]*\bsrc=["']\/consent\.js["'])(?=[^>]*\bdefer(?:\s|\/?>))[^>]*>/i.test(html);
  if (!includesConsent) failures.push(path.relative(root, file));
}

if (failures.length) {
  console.error("Cookie settings pages missing <script src=\"/consent.js\" defer>:");
  failures.forEach(file => console.error(" - " + file));
  process.exit(1);
}
console.log("Cookie consent script check passed (" + htmlFiles.length + " HTML pages scanned).");
