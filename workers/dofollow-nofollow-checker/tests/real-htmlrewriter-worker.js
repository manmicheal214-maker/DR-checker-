import { parseHtml } from "../src/index.js";

export default {
  async fetch(request) {
    const html = await request.text();
    const requestedUrl = request.headers.get("x-requested-url") || "https://example.com/";
    const finalUrl = request.headers.get("x-final-url") || requestedUrl;
    const response = new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
    return Response.json(await parseHtml(response, requestedUrl, finalUrl, null));
  }
};
