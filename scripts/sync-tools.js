#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "tools", "tools-manifest.json"), "utf8"));
const tools = manifest.tools;
const toolDir = path.join(root, "tools");
const htmlFiles = fs.readdirSync(toolDir)
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

function syncToolPage(source, file) {
  const nav = '<span class="tool-links">' + navBlock() + "</span>";
  if (/<span class="tool-links">[\s\S]*?<\/span>/.test(source)) {
    return source.replace(/<span class="tool-links">[\s\S]*?<\/span>/, nav);
  }
  return replaceOrFail(
    source,
    /<nav class="tools-nav">[\s\S]*?<\/nav>/,
    '<nav class="tools-nav"><a href="/">← DR Checker</a><a href="/tools/">Tools</a>' + nav + "</nav>",
    file + " nav"
  );
}

function syncHub(source) {
  let out = syncToolPage(source, "tools/index.html");
  return replaceOrFail(
    out,
    /<section class="tools-grid">[\s\S]*?<\/section>/,
    '<section class="tools-grid">\n<!-- TOOLS-MANIFEST:START -->\n' + hubGrid() +
    '\n<!-- TOOLS-MANIFEST:END -->\n</section>',
    "tools/index.html hub"
  );
}

function syncHome(source) {
  return replaceOrFail(
    source,
    /(<h2 id="more-tools-heading">More free SEO tools<\/h2>\s*<ul>)[\s\S]*?(<\/ul>)/,
    "$1\n<!-- TOOLS-MANIFEST:START -->\n" + homeList() +
    "\n<!-- TOOLS-MANIFEST:END -->\n      $2",
    "index.html homepage tool list"
  );
}

function syncSitemap(source) {
  const block = "<!-- TOOLS-MANIFEST:START -->\n" + sitemapTools() + "\n  <!-- TOOLS-MANIFEST:END -->";
  const re = /<!-- TOOLS-MANIFEST:START -->[\s\S]*?<!-- TOOLS-MANIFEST:END -->/;
  if (re.test(source)) return source.replace(re, block);

  const startMarker = "  <url><loc>https://checkdr.net/tools/redirect-checker.html</loc>";
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error("Could not find sitemap tool region");
  const end = source.indexOf("  <url><loc>https://checkdr.net/about.html</loc>", start);
  if (end === -1) throw new Error("Could not find sitemap static-page boundary");
  return source.slice(0, start) + block + "\n" + source.slice(end);
}

function footerBlock() {
  return '<!-- footer:start -->\n' +
    '<footer class="site-footer">\n' +
    '  <p>Domain Rating data provided through Ahrefs API.</p>\n' +
    '  <nav aria-label="Site footer">\n' +
    '    <a href="/about.html">About</a><span aria-hidden="true">|</span>\n' +
    '    <a href="/how-it-works.html">How It Works</a><span aria-hidden="true">|</span>\n' +
    '    <a href="/privacy.html">Privacy</a><span aria-hidden="true">|</span>\n' +
    '    <a href="/terms.html">Terms</a><span aria-hidden="true">|</span>\n' +
    '    <a href="/contact.html">Contact</a>\n' +
    '  </nav>\n' +
    '</footer>\n' +
    '<!-- footer:end -->';
}

function syncFooter(source, file) {
  const block = footerBlock();
  const markerPattern = /<!-- footer:start -->[\s\S]*?<!-- footer:end -->/;
  let out = source;
  if (markerPattern.test(out)) out = out.replace(markerPattern, block);
  else if (/<div id="site-footer"><\/div>/.test(out)) out = out.replace(/<div id="site-footer"><\/div>/, block);
  else throw new Error(file + " is missing its footer placeholder or markers");
  return out.replace(/\s*<script src="\/?footer\.js" defer><\/script>/g, "");
}

function writeOrCheck(file, next) {
  const fullPath = path.join(root, file);
  const current = fs.readFileSync(fullPath, "utf8");
  if (current === next) return false;
  if (process.argv.includes("--check")) {
    throw new Error(file + " is out of sync with tools/tools-manifest.json");
  }
  fs.writeFileSync(fullPath, next);
  return true;
}

for (const tool of tools) {
  const expected = path.join(toolDir, tool.slug + ".html");
  if (!fs.existsSync(expected)) throw new Error("Manifest tool is missing: " + tool.slug + ".html");
}

let changed = 0;
for (const file of htmlFiles) {
  const rel = "tools/" + file;
  const current = fs.readFileSync(path.join(root, rel), "utf8");
  const next = syncFooter(syncToolPage(current, file), rel);
  changed += writeOrCheck(rel, next) ? 1 : 0;
}

const rootHtmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html")).sort();
for (const file of rootHtmlFiles) {
  const current = fs.readFileSync(path.join(root, file), "utf8");
  changed += writeOrCheck(file, syncFooter(current, file)) ? 1 : 0;
}

const hub = fs.readFileSync(path.join(toolDir, "index.html"), "utf8");
changed += writeOrCheck("tools/index.html", syncFooter(syncHub(hub), "tools/index.html")) ? 1 : 0;

const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
changed += writeOrCheck("index.html", syncHome(home)) ? 1 : 0;

const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
changed += writeOrCheck("sitemap.xml", syncSitemap(sitemap)) ? 1 : 0;

console.log((process.argv.includes("--check") ? "Checked" : "Synchronized") + " tool manifest; " + changed + " file(s) changed.");
