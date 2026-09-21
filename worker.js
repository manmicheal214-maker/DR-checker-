/**
 * Cloudflare Worker - Bulk DR Checker + SEO tools
 * Required secret: AHREFS_API_KEY
 * Required var:    ALLOWED_ORIGIN   (e.g. "https://checkdr.net")
 * Required binding: RATE_LIMIT_KV   (KV namespace)
 */

const VERSION = "2026-09-19-seo-tools-v2-fixed";
const AHREFS_ENDPOINT = "https://api.ahrefs.com/v3/public/domain-rating-free";
const MAX_DOMAINS = 100;
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const MAX_RETRY_MS = 10000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const TOOL_SUBREQUEST_LIMIT = 50;
const STATUS_MAX_URLS = 10;
const META_MAX_URLS = 8;
const DNS_MAX_QUERIES = 40;
const DNS_TYPES = new Set(["A", "AAAA", "MX", "TXT", "NS"]);
const LINKS_MAX_LINKS = 15;
const HEADERS_MAX_URLS = 10;
const SSL_MAX_DOMAINS = 10;
const LINKS_RATE_LIMIT = 15;
const HEADERS_RATE_LIMIT = 15;
const SSL_RATE_LIMIT = 20;
const SSL_TIMEOUT_MS = 15000;

const DR_PER_IP_LIMIT = 10; // requests/hour/IP
const DR_GLOBAL_DOMAIN_BUDGET = 2000; // domain lookups/hour, shared across all callers

// --- CORS ---
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env?.ALLOWED_ORIGIN;
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (allowedOrigin && origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(request, env),
    },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Domain helpers (existing DR checker) ---
function normalizeDomain(value) {
  if (typeof value !== "string") return null;
  let input = value.trim();
  if (!input) return null;
  try {
    if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
    let hostname = new URL(input).hostname.toLowerCase();
    if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    return hostname;
  } catch {
    return null;
  }
}

function isValidDomain(domain) {
  if (!domain || domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      !label.startsWith("-") &&
      !label.endsWith("-") &&
      /^[a-zA-Z0-9-]+$/.test(label)
  );
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_MS);
  }
  return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), MAX_RETRY_MS);
}

async function fetchWithRetry(url, options) {
  let lastError;
  let lastResponse;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      lastResponse = response;
      if (!RETRYABLE.has(response.status) || attempt === MAX_ATTEMPTS) return response;
      await sleep(retryDelay(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) throw error;
      await sleep(Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), MAX_RETRY_MS));
    } finally {
      clearTimeout(timeoutId);
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error("Request failed");
}

function parseResult(domain, data) {
  const rating = Number(data?.domain_rating?.domain_rating);
  if (!Number.isFinite(rating)) return { domain, domain_rating: null, status: "not_found" };
  return { domain, domain_rating: rating, status: "success" };
}

async function checkDomain(domain, apiKey) {
  try {
    const url = new URL(AHREFS_ENDPOINT);
    url.searchParams.set("target", `https://${domain}`);
    url.searchParams.set("output", "json");
    const response = await fetchWithRetry(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Ahrefs API error", response.status, data);
      let error = "Ahrefs API request failed.";
      if (response.status === 401) error = "Ahrefs API authentication failed.";
      else if (response.status === 403) error = "Ahrefs API access was denied.";
      else if (response.status === 429) error = "Ahrefs API rate limit reached. Please try again later.";
      else if (response.status >= 500) error = "Ahrefs API is temporarily unavailable.";
      return { domain, domain_rating: null, status: "failed", error };
    }
    return parseResult(domain, data);
  } catch (error) {
    console.error("Domain check failed", domain, error?.message || error);
    return {
      domain,
      domain_rating: null,
      status: "failed",
      error: error?.name === "AbortError" ? "Ahrefs request timed out." : "Unable to connect to Ahrefs.",
    };
  }
}

async function processDomains(domains, apiKey) {
  const results = new Array(domains.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= domains.length) return;
      results[index] = await checkDomain(domains[index], apiKey);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, domains.length) }, worker));
  return results;
}

// --- Rate limiting ---
async function checkAndIncrement(env, ip, name, limit) {
  if (!env.RATE_LIMIT_KV) return { error: "RATE_LIMIT_KV is not configured." };
  const window = Math.floor(Date.now() / 3600000);
  const key = `ip:${name}:${ip}:${window}`;
  const current = Number((await env.RATE_LIMIT_KV.get(key)) || 0);
  if (current >= limit) return { allowed: false };
  await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 3700 });
  return { allowed: true };
}

async function checkGlobalBudget(env, name, limit, amount) {
  if (!env.RATE_LIMIT_KV) return { error: "RATE_LIMIT_KV is not configured." };
  const window = Math.floor(Date.now() / 3600000);
  const key = `global:${name}:${window}`;
  const current = Number((await env.RATE_LIMIT_KV.get(key)) || 0);
  if (current >= limit) return { allowed: false };
  await env.RATE_LIMIT_KV.put(key, String(current + amount), { expirationTtl: 3700 });
  return { allowed: true };
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function enforceRateLimit(request, env, name, limit) {
  const ip = getClientIp(request);
  const result = await checkAndIncrement(env, ip, name, limit);
  if (result.error) return jsonResponse({ success: false, error: result.error }, 500, request, env);
  if (!result.allowed) {
    return jsonResponse(
      { success: false, error: `Hourly limit reached for ${name}. Please wait for the next hourly window and try again.` },
      429,
      request,
      env
    );
  }
  return null;
}

// --- SSRF protection ---
const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".localhost", ".internal", ".corp", ".home.arpa"];
const BLOCKED_HOSTNAME_EXACT = new Set(["localhost"]);

function ipv4ToLong(parts) {
  return (
    (parseInt(parts[0], 10) << 24) +
    (parseInt(parts[1], 10) << 16) +
    (parseInt(parts[2], 10) << 8) +
    parseInt(parts[3], 10)
  );
}

const BLOCKED_IPV4_RANGES = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4], ["255.255.255.255", 32],
].map(([base, bits]) => {
  const baseLong = ipv4ToLong(base.split("."));
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { baseLong: baseLong & mask, mask };
});

function isIPv4Literal(host) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

function isBlockedIPv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => Number(p) > 255)) return true;
  const long = ipv4ToLong(parts) >>> 0;
  return BLOCKED_IPV4_RANGES.some(({ baseLong, mask }) => (long & mask) === baseLong);
}

function isIPv6Literal(host) {
  return host.includes(":");
}

function isBlockedIPv6(host) {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  if (["fe8", "fe9", "fea", "feb"].some((p) => lower.startsWith(p))) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("2001:db8") || lower.startsWith("ff")) return true;
  if (lower.startsWith("::ffff:")) {
    const embedded = lower.split("::ffff:")[1];
    if (isIPv4Literal(embedded)) return isBlockedIPv4(embedded);
  }
  return false;
}

function isBlockedHostnameString(hostname) {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTNAME_EXACT.has(host)) return true;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (isIPv4Literal(host)) return isBlockedIPv4(host);
  if (isIPv6Literal(host)) return isBlockedIPv6(host);
  return false;
}

function createBudget(limit) {
  let spent = 0;
  return {
    spend(n) {
      if (spent + n > limit) return false;
      spent += n;
      return true;
    },
    remaining() {
      return limit - spent;
    },
  };
}

async function isHostnameSafe(hostname, budget, resolvedCache) {
  if (isBlockedHostnameString(hostname)) return false;
  if (isIPv4Literal(hostname) || isIPv6Literal(hostname)) return true;
  const key = hostname.toLowerCase();
  if (resolvedCache.has(key)) return resolvedCache.get(key);

  for (const type of ["A", "AAAA"]) {
    if (!budget.spend(1)) return false;
    try {
      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        { headers: { Accept: "application/dns-json" } }
      );
      const data = await res.json().catch(() => null);
      for (const answer of data?.Answer || []) {
        if ((type === "A" && isBlockedIPv4(answer.data)) || (type === "AAAA" && isBlockedIPv6(answer.data))) {
          resolvedCache.set(key, false);
          return false;
        }
      }
    } catch {
      resolvedCache.set(key, false);
      return false;
    }
  }
  resolvedCache.set(key, true);
  return true;
}

async function ssrfSafeFetch(initialUrl, { method = "GET", maxHops = 3, timeoutMs = 10000 }, budget, resolvedCache) {
  let currentUrl = initialUrl;
  const chain = [];

  for (let hop = 0; hop <= maxHops; hop++) {
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, error: "Invalid URL.", chain };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "Only http/https URLs are allowed.", chain };
    }

    const safe = await isHostnameSafe(parsed.hostname, budget, resolvedCache);
    if (!safe) {
      return {
        ok: false,
        error: budget.remaining() <= 0 ? "Subrequest budget exceeded for this batch." : "This URL points to a blocked or private address.",
        chain,
        skipped: budget.remaining() <= 0,
      };
    }

    if (!budget.spend(1)) {
      return { ok: false, error: "Subrequest budget exceeded for this batch.", chain, skipped: true };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(currentUrl, { method, redirect: "manual", signal: controller.signal });
    } catch (error) {
      clearTimeout(timeoutId);
      return { ok: false, error: error?.name === "AbortError" ? "Request timed out." : "Could not connect.", chain };
    }
    clearTimeout(timeoutId);

    chain.push({ url: currentUrl, status: response.status });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      try { response.body?.cancel(); } catch {}
      if (!location) return { ok: true, finalUrl: currentUrl, finalStatus: response.status, chain };
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return { ok: true, finalUrl: currentUrl, finalStatus: response.status, chain, response };
  }

  return { ok: false, error: "Too many redirects.", chain };
}

function normalizeToolUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let input = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;
  try {
    const u = new URL(input);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function validateUrlBatch(body, max) {
  if (!body || !Array.isArray(body.urls)) return { error: "urls must be an array." };
  if (!body.urls.length) return { error: "Please provide at least one URL." };
  if (body.urls.length > max) return { error: `Maximum ${max} URLs are allowed per request. Please reduce the batch size.` };
  const urls = body.urls.map(normalizeToolUrl);
  if (urls.some((u) => !u)) return { error: "Each URL must be a valid http/https URL or a bare domain." };
  return { urls };
}

async function processPool(items, handler) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await handler(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

async function handleCheckStatus(request, env) {
  const limited = await enforceRateLimit(request, env, "status", 15);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: "Invalid JSON request." }, 400, request, env); }

  const v = validateUrlBatch(body, STATUS_MAX_URLS);
  if (v.error) return jsonResponse({ success: false, error: v.error }, 400, request, env);

  const budget = createBudget(TOOL_SUBREQUEST_LIMIT);
  const cache = new Map();

  const results = await processPool(v.urls, async (url) => {
    if (budget.remaining() <= 0) return { url, skipped: true, error: "Not processed — reduce batch size and try again." };
    const r = await ssrfSafeFetch(url, { method: "GET", maxHops: 3 }, budget, cache);
    if (r.skipped) return { url, skipped: true, error: "Not processed — reduce batch size and try again.", chain: r.chain || [] };
    return {
      url,
      ok: r.ok,
      final_url: r.finalUrl || null,
      final_status: r.finalStatus || null,
      redirect_count: Math.max(0, (r.chain || []).length - 1),
      chain: r.chain || [],
      error: r.error || null,
    };
  });

  return jsonResponse({ success: true, results, subrequests_used: TOOL_SUBREQUEST_LIMIT - budget.remaining() }, 200, request, env);
}

// --- Lightweight HTML metadata parsing (no DOMParser in Workers) ---
function getAttr(tag, name) {
  const re = new RegExp("\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i");
  const m = tag.match(re);
  return m ? m[2].trim() : null;
}

function firstMeta(html, pred) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) if (pred(tag)) return getAttr(tag, "content") || "";
  return "";
}

function metaByName(html, name) {
  return firstMeta(html, (tag) => (getAttr(tag, "name") || "").toLowerCase() === name.toLowerCase());
}

function metaByProperty(html, prop) {
  return firstMeta(html, (tag) => (getAttr(tag, "property") || "").toLowerCase() === prop.toLowerCase());
}

function firstLinkCanonical(html) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = (getAttr(tag, "rel") || "").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) return getAttr(tag, "href") || "";
  }
  return "";
}

function htmlTitle(html) {
  return (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
}

function decodeBasicEntities(v) {
  return String(v || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

async function readBodyCap(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return await response.text().catch(() => "");
  const decoder = new TextDecoder();
  let received = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      result += decoder.decode(value, { stream: true });
      if (received >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } catch {
    // Return whatever was read before the stream errored out.
  }
  return result;
}

async function handleCheckMeta(request, env) {
  const limited = await enforceRateLimit(request, env, "meta", 15);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: "Invalid JSON request." }, 400, request, env); }

  const v = validateUrlBatch(body, META_MAX_URLS);
  if (v.error) return jsonResponse({ success: false, error: v.error }, 400, request, env);

  const budget = createBudget(TOOL_SUBREQUEST_LIMIT);
  const cache = new Map();

  const results = await processPool(v.urls, async (url) => {
    if (budget.remaining() <= 0) return { url, skipped: true, error: "Not processed — reduce batch size and try again." };
    const r = await ssrfSafeFetch(url, { method: "GET", maxHops: 3 }, budget, cache);
    if (r.skipped) return { url, skipped: true, error: "Not processed — reduce batch size and try again.", chain: r.chain || [] };
    if (!r.ok || !r.response) {
      return {
        url,
        final_url: r.finalUrl || null,
        title: "", description: "", canonical: "",
        og: { title: "", description: "", image: "", type: "" },
        twitter: { card: "", title: "", description: "", image: "" },
        robots: "", h1_count: 0,
        error: r.error || "Unable to fetch page.",
      };
    }
    const html = await readBodyCap(r.response, 300 * 1024);
    return {
      url,
      final_url: r.finalUrl,
      title: decodeBasicEntities(htmlTitle(html)),
      description: decodeBasicEntities(metaByName(html, "description")),
      canonical: decodeBasicEntities(firstLinkCanonical(html)),
      og: {
        title: decodeBasicEntities(metaByProperty(html, "og:title")),
        description: decodeBasicEntities(metaByProperty(html, "og:description")),
        image: decodeBasicEntities(metaByProperty(html, "og:image")),
        type: decodeBasicEntities(metaByProperty(html, "og:type")),
      },
      twitter: {
        card: decodeBasicEntities(metaByName(html, "twitter:card")),
        title: decodeBasicEntities(metaByName(html, "twitter:title")),
        description: decodeBasicEntities(metaByName(html, "twitter:description")),
        image: decodeBasicEntities(metaByName(html, "twitter:image")),
      },
      robots: decodeBasicEntities(metaByName(html, "robots")),
      h1_count: (html.match(/<h1[\s>]/gi) || []).length,
      error: null,
    };
  });

  return jsonResponse({ success: true, results, subrequests_used: TOOL_SUBREQUEST_LIMIT - budget.remaining() }, 200, request, env);
}

async function handleDnsLookup(request, env) {
  const limited = await enforceRateLimit(request, env, "dns", 20);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: "Invalid JSON request." }, 400, request, env); }

  if (!body || !Array.isArray(body.domains) || !Array.isArray(body.types)) {
    return jsonResponse({ success: false, error: "domains and types must be arrays." }, 400, request, env);
  }
  if (!body.domains.length) return jsonResponse({ success: false, error: "Please provide at least one domain." }, 400, request, env);
  if (!body.types.length) return jsonResponse({ success: false, error: "Please provide at least one DNS record type." }, 400, request, env);

  const types = [...new Set(body.types.map((t) => String(t).toUpperCase()))];
  const badTypes = types.filter((t) => !DNS_TYPES.has(t));
  if (badTypes.length) {
    return jsonResponse(
      { success: false, error: `Unsupported DNS record type(s): ${badTypes.join(", ")}. Allowed types: A, AAAA, MX, TXT, NS. ANY is not supported.` },
      400, request, env
    );
  }
  if (body.domains.length * types.length > DNS_MAX_QUERIES) {
    return jsonResponse(
      { success: false, error: `Maximum ${DNS_MAX_QUERIES} domain/type lookups per request. Check fewer domains or fewer record types per request.` },
      400, request, env
    );
  }

  const domains = [];
  for (const raw of body.domains) {
    const d = normalizeDomain(raw);
    if (!d || !isValidDomain(d)) return jsonResponse({ success: false, error: `Invalid domain: ${String(raw)}` }, 400, request, env);
    domains.push(d);
  }

  const unique = [...new Set(domains)];
  const budget = createBudget(TOOL_SUBREQUEST_LIMIT);
  const results = unique.map((domain) => ({ domain, records: Object.fromEntries(types.map((t) => [t, []])), error: null }));
  const jobs = [];
  unique.forEach((domain, di) => types.forEach((type) => jobs.push({ domain, di, type })));

  await processPool(jobs, async (job) => {
    if (!budget.spend(1)) {
      results[job.di].error = "Not processed — reduce batch size and try again.";
      return;
    }
    try {
      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(job.domain)}&type=${job.type}`,
        { headers: { Accept: "application/dns-json" } }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        results[job.di].error = results[job.di].error || `DNS lookup failed for ${job.type}.`;
        return;
      }
      results[job.di].records[job.type] = (data?.Answer || []).map((a) => a.data).filter(Boolean);
    } catch {
      results[job.di].error = results[job.di].error || `DNS lookup failed for ${job.type}.`;
    }
  });

  return jsonResponse({ success: true, results, subrequests_used: TOOL_SUBREQUEST_LIMIT - budget.remaining() }, 200, request, env);
}

async function handleCheckLinks(request, env) {
  const limited = await enforceRateLimit(request, env, "links", LINKS_RATE_LIMIT);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: "Invalid JSON request." }, 400, request, env); }

  const pageUrl = normalizeToolUrl(body?.url);
  if (!pageUrl) return jsonResponse({ success: false, error: "url must be a valid http/https URL or a bare domain." }, 400, request, env);

  const budget = createBudget(TOOL_SUBREQUEST_LIMIT);
  const cache = new Map();
  const r = await ssrfSafeFetch(pageUrl, { method: "GET", maxHops: 3 }, budget, cache);
  if (!r.ok) return jsonResponse({ success: false, error: r.error }, 200, request, env);

  const html = await readBodyCap(r.response, 500 * 1024);
  const tags = html.match(/<a\b[^>]*>/gi) || [];
  const links = [];
  const seen = new Set();

  for (const tag of tags) {
    const href = getAttr(tag, "href");
    if (!href) continue;
    const trimmed = href.trim();
    if (!trimmed || /^(mailto:|tel:|javascript:)/i.test(trimmed) || trimmed.startsWith("#")) continue;
    let resolved;
    try { resolved = new URL(trimmed, r.finalUrl).toString(); } catch { continue; }
    if (resolved.startsWith("http:") || resolved.startsWith("https:")) {
      if (!seen.has(resolved)) {
        seen.add(resolved);
        links.push(resolved);
      }
    }
  }

  const totalLinksFound = links.length;
  const checkedLinks = links.slice(0, LINKS_MAX_LINKS);
  const results = await processPool(checkedLinks, async (link) => {
    if (budget.remaining() <= 0) {
      return { url: link, ok: false, final_status: null, error: "Not processed — subrequest budget exceeded.", skipped: true };
    }
    const result = await ssrfSafeFetch(link, { method: "GET", maxHops: 2 }, budget, cache);
    if (result.skipped) {
      return { url: link, ok: false, final_status: null, error: "Not processed — subrequest budget exceeded.", skipped: true };
    }
    return {
      url: link,
      ok: result.ok,
      final_status: result.finalStatus || null,
      error: result.error || null,
    };
  });

  return jsonResponse({
    success: true,
    page_url: pageUrl,
    final_page_url: r.finalUrl,
    total_links_found: totalLinksFound,
    checked_count: results.length,
    results,
    subrequests_used: TOOL_SUBREQUEST_LIMIT - budget.remaining(),
  }, 200, request, env);
}

async function handleCheckHeaders(request, env) {
  const limited = await enforceRateLimit(request, env, "headers", HEADERS_RATE_LIMIT);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: "Invalid JSON request." }, 400, request, env); }

  const v = validateUrlBatch(body, HEADERS_MAX_URLS);
  if (v.error) return jsonResponse({ success: false, error: v.error }, 400, request, env);

  const budget = createBudget(TOOL_SUBREQUEST_LIMIT);
  const cache = new Map();
  const headerNames = {
    csp: "content-security-policy",
    hsts: "strict-transport-security",
    x_content_type_options: "x-content-type-options",
    x_frame_options: "x-frame-options",
    referrer_policy: "referrer-policy",
    permissions_policy: "permissions-policy",
  };

  const results = await processPool(v.urls, async (url) => {
    if (budget.remaining() <= 0) {
      return { url, final_url: null, headers: Object.fromEntries(Object.keys(headerNames).map((key) => [key, null])), score: 0, error: "Not processed — reduce batch size and try again.", skipped: true };
    }
    const r = await ssrfSafeFetch(url, { method: "GET", maxHops: 3 }, budget, cache);
    if (r.skipped) {
      return { url, final_url: null, headers: Object.fromEntries(Object.keys(headerNames).map((key) => [key, null])), score: 0, error: "Not processed — reduce batch size and try again.", skipped: true };
    }
    if (!r.ok || !r.response) {
      return {
        url,
        final_url: r.finalUrl || null,
        headers: Object.fromEntries(Object.keys(headerNames).map((key) => [key, null])),
        score: 0,
        error: r.error || "Unable to fetch page.",
      };
    }

    const headers = {};
    for (const [key, headerName] of Object.entries(headerNames)) headers[key] = r.response.headers.get(headerName);
    try { r.response.body?.cancel(); } catch {}
    const score = Object.values(headers).filter((value) => value !== null && value !== "").length;

    return { url, final_url: r.finalUrl || url, headers, score, error: null };
  });

  return jsonResponse({ success: true, results, subrequests_used: TOOL_SUBREQUEST_LIMIT - budget.remaining() }, 200, request, env);
}

async function handleCheckSsl(request, env) {
  const limited = await enforceRateLimit(request, env, "ssl", SSL_RATE_LIMIT);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: "Invalid JSON request." }, 400, request, env); }
  if (!body || !Array.isArray(body.domains)) return jsonResponse({ success: false, error: "domains must be an array." }, 400, request, env);
  if (!body.domains.length) return jsonResponse({ success: false, error: "Please provide at least one domain." }, 400, request, env);
  if (body.domains.length > SSL_MAX_DOMAINS) return jsonResponse({ success: false, error: `Maximum ${SSL_MAX_DOMAINS} domains are allowed per request.` }, 400, request, env);

  const domains = [];
  for (const raw of body.domains) {
    const domain = normalizeDomain(raw);
    if (!domain || !isValidDomain(domain)) {
      return jsonResponse({ success: false, error: `Invalid domain: ${String(raw)}` }, 400, request, env);
    }
    if (!domains.includes(domain)) domains.push(domain);
  }

  const results = [];
  for (let start = 0; start < domains.length; start += 3) {
    const batch = domains.slice(start, start + 3);
    const batchResults = await processPool(batch, async (domain) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SSL_TIMEOUT_MS);
      try {
        const response = await fetch(
          `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
          { headers: { Accept: "application/json" }, signal: controller.signal }
        );
        if (!response.ok) {
          return { domain, error: "Certificate Transparency lookup failed. crt.sh may be temporarily unavailable." };
        }
        let entries;
        try { entries = await response.json(); } catch {
          return { domain, error: "Certificate Transparency lookup failed. crt.sh may be temporarily unavailable." };
        }
        if (!Array.isArray(entries)) {
          return { domain, error: "Certificate Transparency lookup failed. crt.sh may be temporarily unavailable." };
        }
        if (!entries.length) {
          return { domain, error: "No certificates found in Certificate Transparency logs for this domain." };
        }

        const validEntries = entries.filter((entry) => Number.isFinite(new Date(entry?.not_before).getTime()));
        if (!validEntries.length) {
          return { domain, error: "Certificate Transparency lookup failed. crt.sh may be temporarily unavailable." };
        }
        const entry = validEntries.reduce((latest, current) =>
          new Date(current.not_before).getTime() > new Date(latest.not_before).getTime() ? current : latest
        );
        const daysRemaining = Math.ceil((new Date(entry.not_after).getTime() - Date.now()) / 86400000);
        return {
          domain,
          issuer: entry.issuer_name || null,
          common_name: entry.common_name || null,
          not_after: entry.not_after || null,
          days_remaining: daysRemaining,
          expired: daysRemaining < 0,
          error: null,
        };
      } catch {
        return { domain, error: "Certificate Transparency lookup failed. crt.sh may be temporarily unavailable." };
      } finally {
        clearTimeout(timeoutId);
      }
    });
    results.push(...batchResults);
  }

  return jsonResponse({ success: true, results }, 200, request, env);
}

async function handleCheck(request, env) {
  if (!env.AHREFS_API_KEY) {
    return jsonResponse({ success: false, error: "AHREFS_API_KEY is not configured in Cloudflare Workers.", version: VERSION }, 500, request, env);
  }

  const limited = await enforceRateLimit(request, env, "dr", DR_PER_IP_LIMIT);
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: "Invalid JSON request.", version: VERSION }, 400, request, env); }

  if (!body || !Array.isArray(body.domains)) {
    return jsonResponse({ success: false, error: "domains must be an array.", version: VERSION }, 400, request, env);
  }
  if (body.domains.length > MAX_DOMAINS) {
    return jsonResponse({ success: false, error: `Maximum ${MAX_DOMAINS} domains are allowed.`, version: VERSION }, 400, request, env);
  }

  const invalidDomains = [];
  const validDomains = [];
  for (const item of body.domains) {
    const domain = normalizeDomain(item);
    if (!domain || !isValidDomain(domain)) invalidDomains.push(typeof item === "string" ? item : String(item));
    else validDomains.push(domain);
  }
  const domains = [...new Set(validDomains)];

  if (!domains.length) {
    return jsonResponse({ success: false, error: "No valid domains were provided.", invalid_domains: invalidDomains, version: VERSION }, 400, request, env);
  }

  const globalCheck = await checkGlobalBudget(env, "dr", DR_GLOBAL_DOMAIN_BUDGET, domains.length);
  if (globalCheck.error) {
    return jsonResponse({ success: false, error: globalCheck.error, version: VERSION }, 500, request, env);
  }
  if (!globalCheck.allowed) {
    return jsonResponse(
      { success: false, error: "This tool has hit its shared usage limit for the hour. Please try again later.", version: VERSION },
      429, request, env
    );
  }

  const results = await processDomains(domains, env.AHREFS_API_KEY);
  return jsonResponse({ success: true, results, invalid_domains: invalidDomains, version: VERSION }, 200, request, env);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse(
        { ok: true, service: "bulk-dr-checker", version: VERSION, endpoints: { health: "/health", check: "/check-dr", status: "/check-status", meta: "/check-meta", dns: "/dns-lookup" } },
        200, request, env
      );
    }

    if (url.pathname === "/" && request.method === "GET") {
      return jsonResponse(
        { ok: true, service: "bulk-dr-checker", version: VERSION, endpoints: { health: "/health", check: "/check-dr", status: "/check-status", meta: "/check-meta", dns: "/dns-lookup" } },
        200, request, env
      );
    }

    if (url.pathname === "/check-dr" && request.method === "POST") return handleCheck(request, env);
    if (url.pathname === "/check-status" && request.method === "POST") return handleCheckStatus(request, env);
    if (url.pathname === "/check-meta" && request.method === "POST") return handleCheckMeta(request, env);
    if (url.pathname === "/dns-lookup" && request.method === "POST") return handleDnsLookup(request, env);
    if (url.pathname === "/check-links" && request.method === "POST") return handleCheckLinks(request, env);
    if (url.pathname === "/check-headers" && request.method === "POST") return handleCheckHeaders(request, env);
    if (url.pathname === "/check-ssl" && request.method === "POST") return handleCheckSsl(request, env);

    return jsonResponse({ success: false, error: "Not Found", version: VERSION }, 404, request, env);
  },
};
