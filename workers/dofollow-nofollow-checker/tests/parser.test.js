import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseRel, linkTypes, targetMatches, resolveLink, robotsNoFollow } from "../src/parsing.js";
import { isPrivateIPv6 } from "../src/index.js";
const fixture = name => fs.readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");

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



test("parseHtml returns robotsNofollow for a robots nofollow meta tag without an error", async () => {
  const previous = globalThis.HTMLRewriter;
  class FakeHTMLRewriter {
    handlers = [];
    on(selector, handlers) { this.handlers.push({ selector, handlers }); return this; }
    transform(response) {
      const owner = this;
      return {
        body: new ReadableStream({
          async start(controller) {
            const html = await response.text();
            for (const { selector, handlers } of owner.handlers) {
              if (selector !== "meta[name]") continue;
              for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
                const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
                if (attrs.name !== undefined) handlers.element({ getAttribute: name => attrs[name] ?? null });
              }
            }
            controller.close();
          }
        })
      };
    }
  }
  globalThis.HTMLRewriter = FakeHTMLRewriter;
  try {
    const { parseHtml } = await import("../src/index.js");
    const result = await parseHtml(
      new Response('<html><head><meta name="robots" content="nofollow"></head><body></body></html>', { status: 200 }),
      "https://example.com/",
      "https://example.com/",
      null
    );
    assert.equal(result.robotsNofollow, true);
    assert.equal(result.error, null);
  } finally {
    if (previous === undefined) delete globalThis.HTMLRewriter;
    else globalThis.HTMLRewriter = previous;
  }
});


test("private IPv6 checks recognize loopback and IPv4-mapped private addresses", () => {
  assert.equal(isPrivateIPv6("::1"), true);
  assert.equal(isPrivateIPv6("::ffff:10.1.2.3"), true);
  assert.equal(isPrivateIPv6("::ffff:192.168.1.10"), true);
  assert.equal(isPrivateIPv6("2001:4860:4860::8888"), false);
});


test("parseHtml collects two fixture links including rel=nofollow", async () => {
  const previous = globalThis.HTMLRewriter;
  class FixtureHTMLRewriter {
    handlers = [];
    on(selector, handlers) { this.handlers.push({ selector, handlers }); return this; }
    transform(response) {
      const owner = this;
      return {
        body: new ReadableStream({
          async start(controller) {
            const html = await response.text();
            for (const { selector, handlers } of owner.handlers) {
              if (selector !== "a[href]") continue;
              for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
                const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
                if (attrs.href === undefined) continue;
                handlers.element({ getAttribute: name => attrs[name] ?? null });
                const text = match[2].replace(/<[^>]*>/g, "");
                if (text) handlers.text({ text, lastInTextNode: true });
                handlers.end();
              }
            }
            controller.close();
          }
        })
      };
    }
  }
  globalThis.HTMLRewriter = FixtureHTMLRewriter;
  try {
    const { parseHtml } = await import("../src/index.js");
    const result = await parseHtml(
      new Response(fixture("two-links.html"), { status: 200, headers: { "Content-Type": "text/html" } }),
      "https://example.com/",
      "https://example.com/",
      null
    );
    assert.equal(result.error, null);
    assert.equal(result.links.length, 2);
    assert.deepEqual(result.links[1].types, ["nofollow"]);
  } finally {
    if (previous === undefined) delete globalThis.HTMLRewriter;
    else globalThis.HTMLRewriter = previous;
  }
});
