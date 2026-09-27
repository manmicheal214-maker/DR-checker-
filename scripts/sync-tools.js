#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "tools", "tools-manifest.json"), "utf8"));
const tools = manifest.tools;
const htmlFiles = fs.readdirSync(path.join(root, "tools"))
  .filter((name) => name.endsWith(".html") && name !== "index.html")
  .sort();

function escHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function navBlock() {
  return tools.map((tool) =>
    '<a href="/tools/' + tool.slug + '.html">' + escHtml(tool.navLabel) + "</a>"
  ).join("");
}

function hubGrid() {
  return tools.map((tool) =>
    '<a class="tool-link panel" href="/tools/' + tool.slug + '.html"><h2>' +
    escHtml(tool.title) + "</h2><p>" + escHtml(tool.description) + "</p></a>"
  ).join("");
}

function homeList() {
  return tools.map((tool) =>
    '        <li><a href="/tools/' + tool.slug + '.html">' + escHtml(tool.title) +
    "</a> — " + escHtml(tool.description) + "</li>"
  ).join("\n");
}

function sitemapTools() {
  return tools.map((tool) =>
    '  <url><loc>https://checkdr.net/tools/' + tool.slug +
    '.html</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>'
  ).join("\n");
}

function replaceOrFail(source, re, replacement, label) {
  if (!re.test(source)) throw new Error("Could not find generated " + label + " region");
  return source.replace(re, replacement);
}

function sync(source, file) {
  let out = source;
  const nav = '<span class="tool-links">' + navBlock() + "</span>";
  out = replaceOrFail(out, /<span class="tool-links">[\\s\\S]*?<\\/span>/, nav, file + " nav");

  if (file === "tools/index.html") {
    out = replaceOrFail(
      out,
      /<section class="tools-grid">[\\s\\S]*?<\\/section>/,
      '<section class="tools-grid">\\n<!-- TOOLS-MANIFEST:START -->\\n' + hubGrid() +
      '\\n<!-- TOOLS-MANIFEST:END -->\\n</section>',
      file + " hub"
    );
  }

  if (file === "index.html") {
    out = replaceOrFail(
      out,
      /(<h2 id="more-tools-heading">More free SEO tools<\\/h2>\\s*<ul>)[\\s\\S]*?(<\\/ul>)/,
      "$1\\n<!-- TOOLS-MANIFEST:START -->\\n" + homeList() + "\\n<!-- TOOLS-MANIFEST:END -->\\n      $2",
      file + " homepage tool list"
    );
  }

  return out;
}

function syncSitemap(source) {
  const block = "<!-- TOOLS-MANIFEST:START -->\\n" + sitemapTools() + "\\n  <!-- TOOLS-MANIFEST:END -->";
  const re = /<!-- TOOLS-MANIFEST:START -->[\\s\\S]*?<!-- TOOLS-MANIFEST:END -->/;
  if (re.test(source)) return source.replace(re, block);
  const marker = "  <url><loc>https://checkdr.net/tools/redirect-checker.html</loc>";
  const start = source.indexOf(marker);
  if (start === -1) throw new Error("Could not find sitemap tool region");
  const end = source.indexOf("  <url><loc>https://checkdr.net/about.html</loc>", start);
  if (end === -1) throw new Error("Could not find sitemap static-page boundary");
  return source.slice(0, start) + block + "\n" + source.slice(end);
}

function writeOrCheck(file, next) {
  const current = fs.readFileSync(path.join(root, file), "utf8");
  if (current === next) return false;
  if (process.argv.includes("--check")) throw new Error(file + " is out of sync with tools/tools-manifest.json");
  fs.writeFileSync(path.join(root, file), next);
  return true;
}

let changed = 0;
for (const file of htmlFiles) {
  const rel = "tools/" + file;
  const current = fs.readFileSync(path.join(root, rel), "utf8");
  changed += writeOrCheck(rel, sync(current, file)) ? 1 : 0;
}

for (const required of tools) {
  const expected = path.join(root, "tools", required.slug + ".html");
  if (!fs.existsSync(expected)) throw new Error("Manifest tool is missing: " + required.slug + ".html");
}

const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
changed += writeOrCheck("sitemap.xml", syncSitemap(sitemap)) ? 1 : 0;

const hub = fs.readFileSync(path.join(root, "tools", "index.html"), "utf8");
changed += writeOrCheck("tools/index.html", sync(hub, "index.html")) ? 1 : 0;

const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
changed += writeOrCheck("index.html", sync(home, "index.html")) ? 1 : 0;

console.log((process.argv.includes("--check") ? "Checked" : "Synchronized") + " tool manifest; " + changed + " file(s) changed.");
