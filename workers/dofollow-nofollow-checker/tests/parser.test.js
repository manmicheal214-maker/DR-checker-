import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Miniflare } from "miniflare";
import { parseRel, linkTypes, targetMatches, resolveLink, robotsNoFollow } from "../src/parsing.js";
import { isPrivateIPv6 } from "../src/index.js";

const fixture = name => fs.readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
async function parseWithRealHtmlRewriter(html, { requestedUrl = "https://example.com/", finalUrl = requestedUrl } = {}) {
  const miniflare = new Miniflare({
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    modulesRoot: new URL("../", import.meta.url).pathname,
    scriptPath: new URL("./real-htmlrewriter-worker.js", import.meta.url).pathname,
    compatibilityDate: "2026-10-21"
  });
  try {
    const response = await miniflare.dispatchFetch("http://worker.test/parse", {
      method: "POST",
      headers: { "x-requested-url": requestedUrl, "x-final-url": finalUrl },
      body: html
    });
    assert.equal(response.status, 200);
    return await response.json();
  } finally {
    await miniflare.dispose();
  }
}

test("rel is a case-insensitive space-separated set", () => {
  assert.deepEqual(parseRel("nofollow sponsored UGC"), ["nofollow", "sponsored", "ugc"]);
  assert.deepEqual(parseRel("External NoFollow sponsored"), ["external", "nofollow", "sponsored"]);
  assert.deepEqual(linkTypes("External NoFollow sponsored"), ["nofollow", "sponsored"]);
  assert.deepEqual(linkTypes(""), ["dofollow"]);
});

test("target matching ignores www and includes subdomains only", () => {
  assert.equal(targetMatches("www.example.com", "example.com"), true);
  assert.equal(targetMatches("blog.example.com", "example.com"), true);
  assert.equal(targetMatches("notexample.com", "example.com"), false);
});

test("relative URLs resolve against final URL and base href", () => {
  assert.equal(resolveLink("child", "https://example.com/redirected/page", "../assets/"), "https://example.com/assets/child");
  assert.equal(resolveLink("/root", "https://example.com/a/b", null), "https://example.com/root");
});

test("robots meta and googlebot none are page-level nofollow", () => {
  assert.equal(robotsNoFollow(fixture("links.html")), true);
  assert.equal(robotsNoFollow(fixture("googlebot-none.html")), true);
  assert.equal(robotsNoFollow("<meta name='robots' content='index,follow'>"), false);
});

test("real HTMLRewriter parses two links and all rel types", async () => {
  const result = await parseWithRealHtmlRewriter(
    '<a href="/first">First</a><a href="https://other.example/path" rel="nofollow sponsored">Second</a>'
  );
  assert.equal(result.error, null);
  assert.equal(result.links.length, 2);
  assert.deepEqual(result.links[1].types, ["nofollow", "sponsored"]);
  assert.equal(result.links[1].href, "https://other.example/path");
});

test("real HTMLRewriter captures image-only anchor alt text", async () => {
  const result = await parseWithRealHtmlRewriter(
    '<a href="/logo"><img src="/logo.png" alt="Company logo"></a>'
  );
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].anchor, "[image] Company logo");
});

test("relative links resolve against the final URL after a redirect", async () => {
  const result = await parseWithRealHtmlRewriter('<a href="child">Child</a>', {
    requestedUrl: "https://example.com/start",
    finalUrl: "https://example.com/redirected/page"
  });
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].href, "https://example.com/redirected/child");
});

test("real HTMLRewriter detects robots nofollow meta", async () => {
  const result = await parseWithRealHtmlRewriter(
    '<html><head><meta name="robots" content="index, nofollow"></head><body><a href="/x">X</a></body></html>'
  );
  assert.equal(result.robotsNofollow, true);
  assert.equal(result.links.length, 1);
});

test("real HTMLRewriter flushes an unclosed anchor at end of stream", async () => {
  const result = await parseWithRealHtmlRewriter('<main><a href="/unfinished">Still open');
  assert.equal(result.error, null);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].href, "https://example.com/unfinished");
  assert.equal(result.links[0].anchor, "Still open");
});

test("private IPv6 checks recognize loopback and IPv4-mapped private addresses", () => {
  assert.equal(isPrivateIPv6("::1"), true);
  assert.equal(isPrivateIPv6("::ffff:10.1.2.3"), true);
  assert.equal(isPrivateIPv6("::ffff:192.168.1.10"), true);
  assert.equal(isPrivateIPv6("2001:4860:4860::8888"), false);
});
