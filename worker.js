/**
 * Cloudflare Worker
 * Bulk Domain Rating Checker
 *
 * Required Worker secret:
 *   AHREFS_API_KEY
 *
 * Required Worker variable:
 *   ALLOWED_ORIGIN
 *
 * ALLOWED_ORIGIN may be either the site origin
 * (https://example.github.io) or the full Pages URL
 * (https://example.github.io/DR-checker-/). Only the origin is used.
 */

const AHREFS_ENDPOINT = "https://api.ahrefs.com/v3/batch-analysis/batch-analysis";
const MAX_DOMAINS = 100;
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 30000;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10000;
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function normalizeAllowedOrigin(value) {
  if (!value || typeof value !== "string") return "";
  try {
    return new URL(value.trim()).origin;
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function corsHeaders(origin, allowedOrigin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (origin && allowedOrigin && origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(data, status, request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = normalizeAllowedOrigin(env.ALLOWED_ORIGIN);
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin, allowedOrigin),
    },
  });
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowedOrigin = normalizeAllowedOrigin(env.ALLOWED_ORIGIN);
  return Boolean(allowedOrigin) && origin === allowedOrigin;
}

function normalizeDomain(value) {
  if (typeof value !== "string") return null;
  let input = value.trim();
  if (!input) return null;
  try {
    if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
    const url = new URL(input);
    let hostname = url.hostname.toLowerCase();
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
  return labels.every((label) =>
    label.length >= 1 && label.length <= 63 &&
    !label.startsWith("-") && !label.endsWith("-") &&
    /^[a-zA-Z0-9-]+$/.test(label)
  );
}

function getRetryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

async function fetchWithRetry(url, options) {
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    let timeoutId;
    const controller = new AbortController();
    try {
      timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(url, { ...options, signal: controller.signal });
      lastResponse = response;
      if (!TRANSIENT_STATUS_CODES.has(response.status) || attempt === RETRY_MAX_ATTEMPTS) return response;
      await new Promise((resolve) => setTimeout(resolve, getRetryDelay(response, attempt)));
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS)));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error("Request failed");
}

async function checkSingleDomain(domain, apiKey) {
  const ahrefsResponse = await fetchWithRetry(AHREFS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      select: ["domain_rating"],
      targets: [{ url: domain, mode: "domain", protocol: "both" }],
      output: "json",
    }),
  });

  if (!ahrefsResponse.ok) {
    const errorData = await ahrefsResponse.json().catch(() => ({}));
    console.error(`Ahrefs API error for ${domain}:`, ahrefsResponse.status, errorData);
    let errorMsg = "Ahrefs API request failed.";
    if (ahrefsResponse.status === 401) errorMsg = "Ahrefs API authentication failed.";
    else if (ahrefsResponse.status === 429) errorMsg = "Ahrefs API rate limit reached. Please try again later.";
    else if (ahrefsResponse.status >= 500) errorMsg = "Ahrefs API is temporarily unavailable.";
    return { domain, domain_rating: null, status: "failed", error: errorMsg };
  }

  let ahrefsData;
  try {
    ahrefsData = await ahrefsResponse.json();
  } catch {
    return { domain, domain_rating: null, status: "failed", error: "Invalid Ahrefs response" };
  }
  return parseSingleDomainResult(domain, ahrefsData);
}

function parseSingleDomainResult(domain, data) {
  let row = null;
  if (Array.isArray(data)) row = data[0];
  else if (Array.isArray(data?.results)) row = data.results[0];
  else if (Array.isArray(data?.data)) row = data.data[0];
  else if (Array.isArray(data?.targets)) row = data.targets[0];
  else if (data?.targets && typeof data.targets === "object") row = data.targets;
  else if (data && typeof data === "object") row = data;

  if (!row || typeof row !== "object") return { domain, domain_rating: null, status: "not_found" };

  const rawDr = row.domain_rating ?? row.domainRating ?? row.dr ?? row.DomainRating ?? row.metrics?.domain_rating;
  const dr = rawDr === null || rawDr === undefined || rawDr === "" ? null : Number(rawDr);
  return {
    domain,
    domain_rating: Number.isFinite(dr) ? dr : null,
    status: Number.isFinite(dr) ? "success" : "not_found",
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try { results[index] = await mapper(items[index]); }
      catch (error) { results[index] = error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function handleCheckDr(request, env) {
  const allowedOrigin = normalizeAllowedOrigin(env.ALLOWED_ORIGIN);
  if (!allowedOrigin) return jsonResponse({ success: false, error: "ALLOWED_ORIGIN is not configured on the server." }, 500, request, env);

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ success: false, error: "Invalid JSON request." }, 400, request, env); }

  if (!body || !Array.isArray(body.domains)) return jsonResponse({ success: false, error: "domains must be an array." }, 400, request, env);
  if (body.domains.length > MAX_DOMAINS) return jsonResponse({ success: false, error: `Maximum ${MAX_DOMAINS} domains are allowed.` }, 400, request, env);

  const validDomains = [];
  const invalidDomains = [];
  for (const item of body.domains) {
    const domain = normalizeDomain(item);
    if (!domain || !isValidDomain(domain)) invalidDomains.push(typeof item === "string" ? item : String(item));
    else validDomains.push(domain);
  }

  const domains = [...new Set(validDomains)];
  if (!domains.length) return jsonResponse({ success: false, error: "No valid domains were provided." }, 400, request, env);
  if (!env.AHREFS_API_KEY) return jsonResponse({ success: false, error: "Ahrefs API key is not configured on the server." }, 500, request, env);

  const results = await mapWithConcurrency(domains, CONCURRENCY, async (domain) => {
    try {
      return await checkSingleDomain(domain, env.AHREFS_API_KEY);
    } catch (error) {
      console.error(`Error checking domain ${domain}:`, error);
      return {
        domain,
        domain_rating: null,
        status: "failed",
        error: error?.name === "AbortError" ? "Request timeout" : "Unable to connect to Ahrefs API",
      };
    }
  });

  return jsonResponse({ success: true, results, invalid_domains: invalidDomains }, 200, request, env);
}

export default {
  async fetch(request, env) {
    if (!originAllowed(request, env)) return jsonResponse({ success: false, error: "Origin is not allowed." }, 403, request, env);

    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, normalizeAllowedOrigin(env.ALLOWED_ORIGIN)) });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ success: true, service: "bulk-dr-checker" }, 200, request, env);
    }
    if (url.pathname === "/check-dr" && request.method === "POST") return handleCheckDr(request, env);
    return jsonResponse({ success: false, error: "Not Found" }, 404, request, env);
  },
};
