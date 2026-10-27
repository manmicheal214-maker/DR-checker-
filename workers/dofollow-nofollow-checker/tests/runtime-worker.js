import { parseHtml } from "../src/index.js";

export default {
  async fetch(request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const html = await request.text();
    const url = new URL(request.url);
    const requestedUrl = url.searchParams.get("requestedUrl") || "https://example.com/original";
    const finalUrl = url.searchParams.get("finalUrl") || "https://example.com/redirected/page.html";
    const target = url.searchParams.get("target") || null;
    const result = await parseHtml(
      new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }),
      requestedUrl,
      finalUrl,
      target
    );
    return Response.json(result);
  }
};
