#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

// Generated HTML must stay aligned with the shared manifest and footer.
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
  const homeCard = '<a class="tool-link panel" href="/"><h2>Bulk Domain Rating Checker</h2>' +
    '<p>Check Ahrefs Domain Rating for up to 100 domains in one batch.</p></a>';
  return [homeCard].concat(tools.map((tool) =>
    '<a class="tool-link panel" href="/tools/' + tool.slug + '.html"><h2>' +
    escHtml(tool.title) + "</h2><p>" + escHtml(tool.description) + "</p></a>"
  )).join("");
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
    '  <p>CheckDR — free bulk Domain Rating checker.</p>\n' +
    '  <p>Ahrefs and Domain Rating are trademarks of their respective owners. CheckDR is not affiliated with Ahrefs.</p>\n' +
    '  <nav aria-label="Site footer">\n' +
    '    <a href="/about.html">About</a><span aria-hidden="true">|</span>\n' +
    '    <a href="/how-it-works.html">How It Works</a><span aria-hidden="true">|</span>\n' +
    '    <a href="/privacy.html">Privacy</a><span aria-hidden="true">|</span>\n' +
    '    <a href="/terms.html">Terms</a><span aria-hidden="true">|</span>\n' +
    '    <a href="/contact.html">Contact</a><span aria-hidden="true">|</span>\n' +
    '    <a href="#" id="cookieSettingsLink">Cookie settings</a>\n' +
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


function jsonLdHub(source) {
  const h1 = (source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const description = (source.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)/i) || [])[1];
  const title = h1 ? h1.replace(/<[^>]+>/g, "").trim() : "";
  if (!title || !description) throw new Error("tools/index.html: missing H1 or meta description");
  const items = [{ title: "Bulk Domain Rating Checker", url: "https://checkdr.net/" }]
    .concat(tools.map(tool => ({ title: tool.title, url: "https://checkdr.net/tools/" + tool.slug + ".html" })));
  const list = items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.title, url: item.url }));
  const schema = { "@context": "https://schema.org", "@type": "CollectionPage", name: title,
    url: "https://checkdr.net/tools/", description,
    mainEntity: { "@type": "ItemList", numberOfItems: list.length, itemListElement: list } };
  const block = "<!-- tools-itemlist:start -->\n<script type=\"application/ld+json\">" +
    JSON.stringify(schema) + "</script>\n<!-- tools-itemlist:end -->";
  const marker = /<!-- tools-itemlist:start -->[\s\S]*?<!-- tools-itemlist:end -->/;
  if (marker.test(source)) return source.replace(marker, block);
  return replaceOrFail(source, /<head[^>]*>/i, "$&\n" + block, "tools/index.html ItemList schema");
}

function validatePages() {
  const files = [];
  function walk(dir, prefix) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name), rel = prefix ? prefix + "/" + name : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else if (name.endsWith(".html")) files.push(rel);
    }
  }
  walk(root, "");
  const failures = [];
  const required = ["og:title", "og:description", "og:type", "og:url", "og:site_name", "og:image", "twitter:image"];
  for (const file of files) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const desc = (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)/i) || [])[1];
    if (!desc || desc.length < 110 || desc.length > 160) failures.push(file + ": meta description length must be 110–160 characters (got " + (desc ? desc.length : 0) + ")");
    const canonical = (html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)/i) || [])[1];
    const expected = "https://checkdr.net/" + (file === "index.html" ? "" : file === "tools/index.html" ? "tools/" : file);
    if (canonical !== expected) failures.push(file + ": canonical must equal " + expected);
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count !== 1) failures.push(file + ": expected exactly one H1 (got " + h1Count + ")");
    if (file === "404.html") {
      if (!/<meta\s+name=["']robots["']\s+content=["']noindex["']/i.test(html)) failures.push(file + ": must contain meta robots noindex");
    } else {
      for (const name of required) {
        const pattern = new RegExp("<meta\\b[^>]*(?:property|name)=['\"]" + name + "['\"]", "i");
        if (!pattern.test(html)) failures.push(file + ": missing " + name);
      }
      if (!/<meta\s+name=["']twitter:card["']\s+content=["']summary_large_image["']/i.test(html)) failures.push(file + ": twitter:card must be summary_large_image");
    }
    for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']*)["']/gi)) {
      const href = match[1].trim();
      if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
      let pathname;
      if (/^https?:\/\//i.test(href)) {
        let url; try { url = new URL(href); } catch { continue; }
        if (!["checkdr.net", "www.checkdr.net"].includes(url.hostname)) continue;
        pathname = decodeURIComponent(url.pathname);
      } else if (href.startsWith("/")) pathname = decodeURIComponent(href.split(/[?#]/)[0]);
      else continue;
      if (!pathname || pathname === "/") pathname = "/index.html";
      else if (pathname.endsWith("/")) pathname += "index.html";
      const target = path.resolve(root, "." + pathname);
      if (!target.startsWith(root + path.sep) && target !== path.join(root, "index.html")) failures.push(file + ": unsafe local href " + href);
      else if (!fs.existsSync(target) || !fs.statSync(target).isFile()) failures.push(file + ": broken href " + href);
    }
  }
  const hub = fs.readFileSync(path.join(root, "tools/index.html"), "utf8");
  const block = (hub.match(/<!-- tools-itemlist:start -->([\s\S]*?)<!-- tools-itemlist:end -->/) || [])[1];
  if (!block) failures.push("tools/index.html: missing or stale ItemList schema block");
  else {
    try {
      const script = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
      if (!script) throw new Error("missing JSON-LD script");
      const schema = JSON.parse(script[1]);
      const cards = [...hub.matchAll(/<a class="tool-link panel" href="([^"]+)"><h2>([\s\S]*?)<\/h2>/g)];
      if (schema.mainEntity.numberOfItems !== cards.length || schema.mainEntity.itemListElement.length !== cards.length) failures.push("tools/index.html: ItemList count does not match visible cards");
      if (cards.some((card, i) => {
        const item = schema.mainEntity.itemListElement[i];
        return !item || item.url !== new URL(card[1], "https://checkdr.net").href || item.name !== card[2].replace(/&amp;/g, "&");
      })) failures.push("tools/index.html: ItemList is stale against visible cards");
    } catch (error) { failures.push("tools/index.html: ItemList JSON-LD is invalid (" + error.message + ")"); }
  }
  if (failures.length) throw new Error("SEO/integrity check failed:\n- " + failures.join("\n- "));
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
changed += writeOrCheck("tools/index.html", syncFooter(jsonLdHub(syncHub(hub)), "tools/index.html")) ? 1 : 0;

const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
changed += writeOrCheck("index.html", syncHome(home)) ? 1 : 0;

const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
changed += writeOrCheck("sitemap.xml", syncSitemap(sitemap)) ? 1 : 0;

if (process.argv.includes("--check")) validatePages();
console.log((process.argv.includes("--check") ? "Checked" : "Synchronized") + " tool manifest; " + changed + " file(s) changed.");
