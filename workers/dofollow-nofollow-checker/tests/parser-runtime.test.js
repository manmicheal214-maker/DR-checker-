import test from "node:test";
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";

test("parseHtml handles anchors in the real Workers HTMLRewriter runtime", async () => {
  const worker = await unstable_dev("tests/runtime-worker.js", {
    local: true,
    logLevel: "error",
    experimental: { disableExperimentalWarning: true }
  });

  try {
    const html = `<!doctype html>
      <html><head><meta name="robots" content="index, nofollow"></head><body>
        <a href="https://outside.example/nofollow" rel="nofollow sponsored">Tagged link</a>
        <a href="/images"><img src="/badge.png" alt="Partner badge"></a>
        <a href="relative">Relative link</a>
        <a href="https://blog.example.com/unclosed" rel="ugc">Unclosed link`;
    const response = await worker.fetch(
      "/?requestedUrl=https%3A%2F%2Fexample.com%2Foriginal&finalUrl=https%3A%2F%2Fexample.com%2Fredirected%2Fpage.html&target=example.com",
      { method: "POST", body: html }
    );
    assert.equal(response.status, 200);
    const result = await response.json();

    assert.equal(result.error, null);
    assert.equal(result.robotsNofollow, true);
    assert.equal(result.links.length, 4);
    assert.deepEqual(result.links[0].types, ["nofollow", "sponsored"]);
    assert.equal(result.links[1].anchor, "[image] Partner badge");
    assert.equal(result.links[1].href, "https://example.com/images");
    assert.equal(result.links[2].href, "https://example.com/redirected/relative");
    assert.equal(result.links[3].href, "https://blog.example.com/unclosed");
    assert.deepEqual(result.links[3].types, ["ugc"]);
    assert.equal(result.matched.length, 2);
  } finally {
    await worker.stop();
  }
});
