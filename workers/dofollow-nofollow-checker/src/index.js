import { parseRel, linkTypes, targetMatches, normalizeHost, resolveLink } from "./parsing.js";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const CACHE_TTL = 300;
const TYPES = ["nofollow", "sponsored", "ugc"];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
function allowedOrigin(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "https://checkdr.net,https://www.checkdr.net").split(",").map(x => x.trim()).filter(Boolean);
  return !!origin && allowed.includes(origin);
}
function cors(origin) {
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
}
function isPrivateIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = m.slice(1).map(Number);
  if (a.some(n => n > 255)) return true;
  return a[0] === 0 || a[0] === 10 || a[0] === 127 || (a[0] === 169 && a[1] === 254) ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168) ||
    (a[0] === 100 && a[1] >= 64 && a[1] <= 127) || (a[0] >= 224);
}
function isPrivateIPv6(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "::" || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || /^fe[89ab]/.test(h) || h.startsWith("ff") || h.startsWith("::ffff:127.") || h.startsWith("::ffff:10.") || h.startsWith("::ffff:192.168.");
}
function validatePublicUrl(input) {
  let u;
  try { u = new URL(input); } catch { return { error: "invalid_url" }; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return { error: "invalid_url" };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      isPrivateIPv4(host) || host.includes(":") && isPrivateIPv6(host)) return { error: "invalid_url" };
  return { url: u };
}
function errorResponse(url, error, status = null, finalUrl = null) {
  return { url, finalUrl, status, robotsNofollow: false, links: [], matched: [], error };
}
async function verifyTurnstile(token, request, env) {
  if (!token || !env.TURNSTILE_SECRET) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    return d.success === true;
  } catch { return false; }
}
function boundedBody(response) {
  let seen = 0;
  const reader = response.body;
  if (!reader) return new Response(null, { headers: response.headers });
  const stream = reader.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > MAX_BYTES) { controller.error(new Error("too_large")); return; }
      controller.enqueue(chunk);
    }
  }));
  return new Response(stream, { status: response.status, headers: response.headers });
}
async function fetchHtml(initialUrl) {
  let current = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const check = validatePublicUrl(current);
    if (check.error) return { error: "invalid_url", finalUrl: current };
    let response;
    try {
      response = await fetch(check.url.href, {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "CheckDRLinkChecker/1.0 (+https://checkdr.net)", "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" }
      });
    } catch (e) {
      return { error: e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : "unreachable", finalUrl: current };
    }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (!location || redirects === MAX_REDIRECTS) return { error: "unreachable", status: response.status, finalUrl: check.url.href };
      current = new URL(location, check.url).href;
      continue;
    }
    if ([401,403,429].includes(response.status)) return { error: "blocked", status: response.status, finalUrl: response.url || check.url.href };
    if (!response.ok) return { error: "http_" + response.status, status: response.status, finalUrl: response.url || check.url.href };
    const type = (response.headers.get("Content-Type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return { error: "not_html", status: response.status, finalUrl: response.url || check.url.href };
    return { response: boundedBody(response), status: response.status, finalUrl: response.url || check.url.href };
  }
  return { error: "unreachable", finalUrl: current };
}
async function parseHtml(response, requestedUrl, finalUrl, target) {
  const links = [];
  let robotsNofollow = false;
  let baseHref = null;
  let currentAnchor = null;
  let tooLarge = false;
  const rewriter = new HTMLRewriter()
    .on("meta[name]", {
      element(el) {
        const name = (el.getAttribute("name") || "").toLowerCase();
        if (name !== "robots" && name !== "googlebot") return;
        const content = (el.getAttribute("content") || "").toLowerCase().split(/[\s,]+/);
        if (content.includes("nofollow") || content.includes("none")) robotsNofollow = true;
      }
    })
    .on("base[href]", { element(el) { if (!baseHref) baseHref = el.getAttribute("href"); } })
    .on("a[href]", {
      element(el) {
        currentAnchor = { rawHref: el.getAttribute("href") || "", anchor: "", rel: el.getAttribute("rel") || "", imageAlt: "", hasText: false };
      },
      text(text) { if (currentAnchor && text.text.trim()) { currentAnchor.anchor += text.text; currentAnchor.hasText = true; } },
      end() {
        if (!currentAnchor) return;
        let href = currentAnchor.rawHref.trim();
        if (href && !/^(#|javascript:|mailto:|tel:|data:)/i.test(href)) {
          try {
            const resolvedHref = resolveLink(href, finalUrl, baseHref);
            if (resolvedHref) {
              const rel = parseRel(currentAnchor.rel);
              const hostname = new URL(resolvedHref).hostname;
              links.push({ href: resolvedHref, anchor: currentAnchor.hasText ? currentAnchor.anchor.trim() : (currentAnchor.imageAlt ? "[image] " + currentAnchor.imageAlt : "[no anchor text]"), rel, types: linkTypes(currentAnchor.rel), scope: normalizeHost(new URL(finalUrl).hostname) === normalizeHost(hostname) ? "internal" : "external", _hostname: hostname });
            }
          } catch {}
        }
        currentAnchor = null;
      }
    })
    .on("a img[alt]", { element(el) { if (currentAnchor && !currentAnchor.imageAlt) currentAnchor.imageAlt = el.getAttribute("alt") || ""; } });
  try {
    const parsedResponse = rewriter.transform(response);\n    const reader = parsedResponse.body.getReader();\n    while (true) { const { done } = await reader.read(); if (done) break; }
  } catch (e) {
    if (String(e?.message || e).includes("too_large")) tooLarge = true;
    else throw e;
  }
  if (tooLarge) return { error: "too_large" };
  const clean = links.map(({ _hostname, ...link }) => link);
  const matched = target ? clean.filter(link => {
    try { return targetMatches(new URL(link.href).hostname, target); } catch { return false; }
  }) : [];
  return { url: requestedUrl, finalUrl, status: response.status, robotsNofollow, links: clean, matched, error: null };
}
async function handle(request, env, ctx) {
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigin(origin, env)) return json({ error: "origin_not_allowed" }, 403);
  const corsHeaders = cors(origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...corsHeaders, "Access-Control-Max-Age": "86400" } });
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, corsHeaders);
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
    if (!success) return json({ error: "rate_limited" }, 429, corsHeaders);
  }
  const reqUrl = new URL(request.url);
  if (reqUrl.pathname !== "/check") return json({ error: "not_found" }, 404, corsHeaders);
  const rawUrl = reqUrl.searchParams.get("url") || "";
  const targetRaw = (reqUrl.searchParams.get("target") || "").trim();
  const token = reqUrl.searchParams.get("token") || "";
  const validation = validatePublicUrl(rawUrl);
  if (validation.error) return json(errorResponse(rawUrl, "invalid_url"), 400, corsHeaders);
  let target = null;
  if (targetRaw) {
    try {
      const tu = new URL(/^https?:\/\//i.test(targetRaw) ? targetRaw : "https://" + targetRaw);
      if (!["http:", "https:"].includes(tu.protocol) || tu.username || tu.password || !tu.hostname || tu.hostname.includes("/") || tu.hostname.endsWith(".local") || tu.hostname === "localhost" || isPrivateIPv4(tu.hostname)) throw new Error();
      target = normalizeHost(tu.hostname);
    } catch { return json(errorResponse(rawUrl, "invalid_url"), 400, corsHeaders); }
  }
  if (!(await verifyTurnstile(token, request, env))) return json({ error: "invalid_turnstile" }, 403, corsHeaders);
  const cacheKey = new Request("https://checkdr-cache.invalid/" + btoa(encodeURIComponent(validation.url.href + "\n" + (target || ""))).replace(/[^a-zA-Z0-9_-]/g, ""), { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return new Response(cached.body, { status: cached.status, headers: { ...Object.fromEntries(cached.headers), ...corsHeaders } });
  const fetched = await fetchHtml(validation.url.href);
  let result;
  if (fetched.error) result = errorResponse(validation.url.href, fetched.error, fetched.status || null, fetched.finalUrl || null);
  else {
    try { result = await parseHtml(fetched.response, validation.url.href, fetched.finalUrl, target); }
    catch { result = errorResponse(validation.url.href, "unreachable", fetched.status, fetched.finalUrl); }
  }
  const response = json(result, 200, corsHeaders);
  if (!result.error) {
    const stored = new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
    ctx.waitUntil(cache.put(cacheKey, stored));
  }
  return response;
}
export default { fetch: handle };
