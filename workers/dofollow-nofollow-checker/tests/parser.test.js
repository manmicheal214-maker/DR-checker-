import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseRel, linkTypes, targetMatches, resolveLink, robotsNoFollow } from "../src/parsing.js";
const fixture = name => fs.readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");

test("rel is a case-insensitive space-separated set", () => {
  assert.deepEqual(parseRel("nofollow sponsored UGC"), ["nofollow", "sponsored", "ugc"]);
  assert.deepEqual(linkTypes("NoFollow sponsored"), ["nofollow", "sponsored"]);
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
