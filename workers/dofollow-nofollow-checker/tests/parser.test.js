import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseRel, linkTypes, targetMatches, resolveLink, robotsNoFollow } from "../src/parsing.js";
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
      return {
        body: new ReadableStream({
          async start(controller) {
            const html = await response.text();
            for (const { selector, handlers } of thisOwner.handlers) {
              if (selector !== "meta[name]") continue;
              for (const tag of html.match(/<meta\\b[^>]*>/gi) || []) {
                const attrs = Object.fromEntries([...tag.matchAll(/([\\w-]+)\\s*=\\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
                if (attrs.name !== undefined) handlers.element({ getAttribute: name => attrs[name] ?? null });
              }
            }
            controller.close();
          }
        })
      };
      const thisOwner = this;
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
