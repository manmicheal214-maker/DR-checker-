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

function hubItems() {
  return [{
    title: "Bulk Domain Rating Checker",
    description: "Check Ahrefs Domain Rating for up to 100 domains in one batch.",
    url: "/"
  }].concat(tools.map((tool) => ({
    title: tool.title,
    description: tool.description,
    url: "/tools/" + tool.slug + ".html"
  })));
}

function hubGrid() {
  return hubItems().map((item) =>
    '<a class="tool-link panel" href="' + item.url + '"><h2>' +
    escHtml(item.title) + "</h2><p>" + escHtml(item.description) + "</p></a>"
  ).join("");
}

function homeList() {
  return tools.map((tool) =>
    '        <li><a href="/tools/' + tool.slug + '.html">' + escHtml(tool.title) +
    "</a> — " + escHtml(tool.description) + "</li>"
  ).join("\n");
}

const SITEMAP_LASTMOD = {
  "/": "2026-11-12",
  "/tools/": "2026-11-12",
  "/tools/redirect-checker.html": "2026-11-12",
  "/tools/site-audit.html": "2026-11-12",
  "/tools/site-audit-domain.html": "2026-11-12",
  "/tools/meta-preview.html": "2026-11-12",
  "/tools/dns-lookup.html": "2026-11-12",
  "/tools/broken-links.html": "2026-11-12",
  "/tools/security-headers.html": "2026-11-12",
  "/tools/ssl-checker.html": "2026-11-12",
  "/tools/title-length-checker.html": "2026-11-12",
  "/tools/readability-checker.html": "2026-11-12",
  "/tools/writing-clarity-checker.html": "2026-11-12",
  "/tools/schema-generator.html": "2026-11-12",
  "/tools/sitemap-generator.html": "2026-11-12",
  "/tools/robots-generator.html": "2026-11-12",
  "/tools/social-preview-builder.html": "2026-11-12",
  "/tools/hreflang-generator.html": "2026-11-12",
  "/tools/keyword-clustering.html": "2026-11-12",
  "/tools/dofollow-nofollow-checker.html": "2026-11-05",
  "/about.html": "2026-11-12",
  "/how-it-works.html": "2026-11-12",
  "/privacy.html": "2026-11-12",
  "/terms.html": "2026-11-11",
  "/contact.html": "2026-11-11"
};

function sitemapEntry(url) {
  const lastmod = SITEMAP_LASTMOD[url];
  if (!lastmod || !/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) {
    throw new Error("Missing or invalid sitemap lastmod for " + url);
  }
  return "  <url><loc>https://checkdr.net" + url +
    "</loc><lastmod>" + lastmod + "</lastmod></url>";
}

function syncSitemap() {
  const urls = ["/", "/tools/"].concat(
    tools.map((tool) => "/tools/" + tool.slug + ".html"),
    ["/about.html", "/how-it-works.html", "/privacy.html", "/terms.html", "/contact.html"]
  );
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(sitemapEntry).join("\n") + "\n</urlset>\n";
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
  const markerPattern = /<!-- footer:start -->[\s\S]*?<!-- footer:end -->/g;
  let out = source;
  if (markerPattern.test(out)) {
    let kept = false;
    markerPattern.lastIndex = 0;
    out = out.replace(markerPattern, () => {
      if (kept) return "";
      kept = true;
      return block;
    });
  } else if (/<div id="site-footer"><\/div>/.test(out)) {
    out = out.replace(/<div id="site-footer"><\/div>/, block);
  } else throw new Error(file + " is missing its footer placeholder or markers");
  return out.replace(/\s*<script src="\/?footer\.js" defer><\/script>/g, "");
}


function jsonLdHub(source) {
  const h1 = (source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const description = (source.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)/i) || [])[1];
  const title = h1 ? h1.replace(/<[^>]+>/g, "").trim() : "";
  if (!title || !description) throw new Error("tools/index.html: missing H1 or meta description");
  const items = hubItems().map(item => ({
    title: item.title,
    url: new URL(item.url, "https://checkdr.net").href
  }));
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


const FAQ_TOOL_PAGES = new Set([
  "tools/site-audit.html", "tools/meta-preview.html", "tools/dns-lookup.html",
  "tools/broken-links.html", "tools/security-headers.html", "tools/ssl-checker.html",
  "tools/sitemap-generator.html", "tools/robots-generator.html",
  "tools/social-preview-builder.html", "tools/hreflang-generator.html",
  "tools/dofollow-nofollow-checker.html"
]);

function plainText(html) {
  return String(html).replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function questionTokens(value) {
  return plainText(value).toLowerCase()
    .replace(/\bchecker\b/g, "tool").replace(/\bedit\b/g, "change")
    .replace(/\bperform\b/g, "do").replace(/\bchecks?\b/g, "validate")
    .replace(/\burls\b/g, "url").replace(/\bexists\b/g, "exist")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).filter((word) => word && ![
      "does", "do", "this", "that", "it", "a", "an", "the", "is", "are",
      "how", "what", "why", "can", "i", "my", "your", "to", "for", "of",
      "on", "in", "and", "or", "will", "be"
    ].includes(word));
}

function nearDuplicateQuestion(left, right) {
  const a = new Set(questionTokens(left));
  const b = new Set(questionTokens(right));
  if (!a.size || !b.size) return false;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / new Set([...a, ...b]).size >= 0.72;
}

function removeRepeatedContentSections(source) {
  const sections = [...source.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)];
  const seen = new Map();
  let out = source;
  for (let i = sections.length - 1; i >= 0; i--) {
    const match = sections[i];
    const heading = match[0].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    if (!heading) continue;
    const title = plainText(heading[1]).toLowerCase();
    const normalized = match[0].replace(/\s+/g, " ").trim();
    if (seen.get(title) === normalized) {
      out = out.slice(0, match.index) + out.slice(match.index + match[0].length);
    } else if (!seen.has(title)) {
      seen.set(title, normalized);
    }
  }
  return out;
}

function syncToolFaq(source, file) {
  if (!FAQ_TOOL_PAGES.has(file)) return source;
  let out = removeRepeatedContentSections(source);
  const sections = [...out.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)];
  const main = sections.find((section) =>
    /<h2\b[^>]*>\s*Frequently asked questions\s*<\/h2>/i.test(section[0])
  );
  if (!main) throw new Error(file + ": missing main FAQ section");
  const faqItemPattern = /<div class="faq-item">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/gi;
  const existing = [...main[0].matchAll(faqItemPattern)].map((match) => ({
    question: plainText(match[1]), answer: plainText(match[2])
  }));
  const additions = [];
  const edits = [];
  for (const section of sections) {
    if (section.index === main.index) continue;
    const heading = section[0].match(/<h3\b[^>]*>\s*Frequently asked questions\s*<\/h3>/i);
    if (!heading) continue;
    const tail = section[0].slice(heading.index + heading[0].length);
    for (const item of tail.matchAll(/<p>\s*<strong>([\s\S]*?)<\/strong>\s*([\s\S]*?)<\/p>/gi)) {
      const question = plainText(item[1]);
      const answer = plainText(item[2]);
      if (question && answer &&
          !existing.some((entry) => nearDuplicateQuestion(entry.question, question)) &&
          !additions.some((entry) => nearDuplicateQuestion(entry.question, question))) {
        additions.push({ question, answer, questionHtml: item[1], answerHtml: item[2] });
      }
    }
    const cleaned = section[0].replace(
      /<h3\b[^>]*>\s*Frequently asked questions\s*<\/h3>(?:\s*<p>\s*<strong>[\s\S]*?<\/strong>[\s\S]*?<\/p>)*/i,
      ""
    );
    edits.push({ index: section.index, length: section[0].length, value: cleaned });
  }
  for (const edit of edits.sort((a, b) => b.index - a.index)) {
    out = out.slice(0, edit.index) + edit.value + out.slice(edit.index + edit.length);
  }
  if (additions.length) {
    const faqSection = out.match(/<section\b[^>]*>[\s\S]*?<h2\b[^>]*>\s*Frequently asked questions\s*<\/h2>[\s\S]*?<\/section>/i);
    if (!faqSection) throw new Error(file + ": FAQ section disappeared during merge");
    const markup = additions.map((item) =>
      '<div class="faq-item"><h3>' + item.questionHtml + '</h3><p>' + item.answerHtml + '</p></div>'
    ).join("");
    const updated = faqSection[0].replace(/<\/section>$/i, markup + "</section>");
    out = out.slice(0, faqSection.index) + updated + out.slice(faqSection.index + faqSection[0].length);
  }
  let visibleSection = out.match(/<section\b[^>]*>[\s\S]*?<h2\b[^>]*>\s*Frequently asked questions\s*<\/h2>[\s\S]*?<\/section>/i);
  const faqMatches = [...visibleSection[0].matchAll(faqItemPattern)];
  const seenQuestions = [];
  const duplicateItems = [];
  for (const item of faqMatches) {
    const question = plainText(item[1]);
    if (seenQuestions.some((seen) => nearDuplicateQuestion(seen, question))) {
      duplicateItems.push({ index: visibleSection.index + item.index, length: item[0].length });
    } else {
      seenQuestions.push(question);
    }
  }
  for (const item of duplicateItems.sort((a, b) => b.index - a.index)) {
    out = out.slice(0, item.index) + out.slice(item.index + item.length);
  }
  visibleSection = out.match(/<section\b[^>]*>[\s\S]*?<h2\b[^>]*>\s*Frequently asked questions\s*<\/h2>[\s\S]*?<\/section>/i);
  const visibleItems = [...visibleSection[0].matchAll(faqItemPattern)].map((match) => ({
    question: plainText(match[1]), answer: plainText(match[2])
  }));
  const jsonLdPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i;
  const jsonLd = out.match(jsonLdPattern);
  if (!jsonLd) throw new Error(file + ": missing JSON-LD");
  const schema = JSON.parse(jsonLd[1]);
  const faq = (schema["@graph"] || []).find((item) => item["@type"] === "FAQPage") ||
    (schema["@type"] === "FAQPage" ? schema : null);
  if (!faq) throw new Error(file + ": missing FAQPage JSON-LD");
  faq.mainEntity = visibleItems.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer }
  }));
  out = out.replace(jsonLdPattern, '<script type="application/ld+json">' + JSON.stringify(schema) + "</script>");

  let headings = [...out.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const grouped = new Map();
  for (const heading of headings) {
    const title = plainText(heading[2]).toLowerCase();
    if (!grouped.has(title)) grouped.set(title, []);
    grouped.get(title).push(heading);
  }
  for (const [title, matches] of grouped) {
    if (matches.length < 2) continue;
    const descriptive = matches.find((heading) =>
      heading[1] === "2" && title !== "frequently asked questions"
    );
    if (descriptive) {
      const renamed = descriptive[0].replace(/>([\s\S]*?)</,
        ">" + plainText(descriptive[2]) + " overview<");
      out = out.replace(descriptive[0], renamed);
    }
  }
  headings = [...out.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const titles = headings.map((heading) => plainText(heading[2]).toLowerCase());
  if (titles.filter((title) => title === "frequently asked questions").length !== 1 ||
      headings.filter((heading) => heading[1] === "1").length !== 1 ||
      titles.some((title, index) => titles.indexOf(title) !== index)) {
    throw new Error(file + ": duplicate FAQ or heading text remains");
  }
  return out;
}

function validatePages() {
  const files = [];
  function walk(dir, prefix) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name), rel = prefix ? prefix + "/" + name : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else if (name.endsWith(".html") && !/(^|\/)tests\/fixtures\//.test(rel)) files.push(rel);
    }
  }
  walk(root, "");
  const failures = [];
  const required = ["og:title", "og:description", "og:type", "og:url", "og:site_name", "og:image", "twitter:image"];
  for (const file of files) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const descMatch = html.match(/<meta\b(?=[^>]*\bname=["\']description["\'])(?=[^>]*\bcontent=(["\'])(.*?)\1)[^>]*>/i);
    const desc = descMatch ? descMatch[2] : undefined;
    if (!desc || desc.length < 110 || desc.length > 160) failures.push(file + ": meta description length must be 110–160 characters (got " + (desc ? desc.length : 0) + ")");
    const canonical = (html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)/i) || [])[1];
    const expected = "https://checkdr.net/" + (file === "index.html" ? "" : file === "tools/index.html" ? "tools/" : file);
    if (canonical !== expected) failures.push(file + ": canonical must equal " + expected);
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count !== 1) failures.push(file + ": expected exactly one H1 (got " + h1Count + ")");
    if (FAQ_TOOL_PAGES.has(file)) {
      const headings = [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
      const headingText = headings.map((match) => plainText(match[2]).toLowerCase());
      if (headingText.filter((value) => value === "frequently asked questions").length !== 1) failures.push(file + ": expected exactly one FAQ heading");
      if (headingText.some((value, index) => headingText.indexOf(value) !== index)) failures.push(file + ": duplicate heading text");
      for (let i = 1; i < headings.length; i++) {
        if (Number(headings[i][1]) > Number(headings[i - 1][1]) + 1) failures.push(file + ": skipped heading level before " + plainText(headings[i][2]));
      }
      try {
        const faqSection = html.match(/<section\b[^>]*>[\s\S]*?<h2\b[^>]*>\s*Frequently asked questions\s*<\/h2>[\s\S]*?<\/section>/i);
        const visible = [...faqSection[0].matchAll(/<div class="faq-item">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/gi)]
          .map((match) => ({ question: plainText(match[1]), answer: plainText(match[2]) }));
        const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
        const schema = JSON.parse(jsonLd[1]);
        const faq = (schema["@graph"] || []).find((item) => item["@type"] === "FAQPage");
        const structured = faq.mainEntity.map((item) => ({ question: item.name, answer: item.acceptedAnswer.text }));
        if (JSON.stringify(structured) !== JSON.stringify(visible)) failures.push(file + ": FAQ JSON-LD does not match visible questions and answers");
      } catch (error) {
        failures.push(file + ": FAQ JSON-LD validation failed (" + error.message + ")");
      }
    }
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
  let next = syncToolPage(current, file);
  next = syncToolFaq(next, rel);
  next = syncFooter(next, rel);
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
changed += writeOrCheck("sitemap.xml", syncSitemap()) ? 1 : 0;

if (process.argv.includes("--check")) validatePages();
console.log((process.argv.includes("--check") ? "Checked" : "Synchronized") + " tool manifest; " + changed + " file(s) changed.");
