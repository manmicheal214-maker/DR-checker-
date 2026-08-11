/**
 * Cloudflare Worker - Bulk DR Checker
 *
 * Required secret:
 *   AHREFS_API_KEY
 *
 * Optional variable:
 *   ALLOWED_ORIGIN (informational; CORS is intentionally public because
 *   the GitHub Pages frontend is a public browser application.)
 */

const AHREFS_ENDPOINT = "https://api.ahrefs.com/v3/batch-analysis/batch-analysis";
const MAX_DOMAINS = 100;
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const MAX_RETRY_MS = 10000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/*
 * This endpoint is called directly from a public GitHub Pages site.
 * No browser credentials/cookies are used, so wildcard CORS is appropriate.
 * The Ahrefs API key never leaves this Worker.
 */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      lastResponse = response;

      if (!RETRYABLE.has(response.status) || attempt === MAX_ATTEMPTS) {
        return response;
      }

      await sleep(retryDelay(response, attempt));
    } catch (error) {
      lastError = error;

      if (attempt === MAX_ATTEMPTS) throw error;

      await sleep(
        Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), MAX_RETRY_MS)
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error("Request failed");
}

function parseResult(domain, data) {
  let row = null;

  if (Array.isArray(data)) row = data[0];
  else if (Array.isArray(data?.results)) row = data.results[0];
  else if (Array.isArray(data?.data)) row = data.data[0];
  else if (Array.isArray(data?.targets)) row = data.targets[0];
  else if (data?.targets && typeof data.targets === "object") row = data.targets;
  else if (data && typeof data === "object") row = data;

  if (!row || typeof row !== "object") {
    return { domain, domain_rating: null, status: "not_found" };
  }

  const raw =
    row.domain_rating ??
    row.domainRating ??
    row.dr ??
    row.DomainRating ??
    row.metrics?.domain_rating;

  const rating =
    raw === null || raw === undefined || raw === "" ? null : Number(raw);

  return {
    domain,
    domain_rating: Number.isFinite(rating) ? rating : null,
    status: Number.isFinite(rating) ? "success" : "not_found",
  };
}

async function checkDomain(domain, apiKey) {
  try {
    const response = await fetchWithRetry(AHREFS_ENDPOINT, {
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

    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      console.error("Ahrefs API error", response.status, details);

      let error = "Ahrefs API request failed.";
      if (response.status === 401) error = "Ahrefs API authentication failed. Check AHREFS_API_KEY.";
      else if (response.status === 403) error = "Ahrefs API access was denied. Check your Ahrefs account/API permissions.";
      else if (response.status === 429) error = "Ahrefs API rate limit reached. Please try again later.";
      else if (response.status >= 500) error = "Ahrefs API is temporarily unavailable.";

      return { domain, domain_rating: null, status: "failed", error };
    }

    const data = await response.json().catch(() => null);
    if (!data) {
      return { domain, domain_rating: null, status: "failed", error: "Invalid Ahrefs response." };
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

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, domains.length) }, worker)
  );

  return results;
}

async function handleCheck(request, env) {
  if (!env.AHREFS_API_KEY) {
    return jsonResponse({
      success: false,
      error: "AHREFS_API_KEY is not configured in Cloudflare Workers.",
    }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON request." }, 400);
  }

  if (!body || !Array.isArray(body.domains)) {
    return jsonResponse({ success: false, error: "domains must be an array." }, 400);
  }

  if (body.domains.length > MAX_DOMAINS) {
    return jsonResponse({
      success: false,
      error: `Maximum ${MAX_DOMAINS} domains are allowed.`,
    }, 400);
  }

  const invalidDomains = [];
  const validDomains = [];

  for (const item of body.domains) {
    const domain = normalizeDomain(item);

    if (!domain || !isValidDomain(domain)) {
      invalidDomains.push(typeof item === "string" ? item : String(item));
    } else {
      validDomains.push(domain);
    }
  }

  const domains = [...new Set(validDomains)];

  if (!domains.length) {
    return jsonResponse({
      success: false,
      error: "No valid domains were provided.",
      invalid_domains: invalidDomains,
    }, 400);
  }

  const results = await processDomains(domains, env.AHREFS_API_KEY);

  return jsonResponse({
    success: true,
    results,
    invalid_domains: invalidDomains,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({
        ok: true,
        service: "bulk-dr-checker",
        cors: "public",
        ahrefsConfigured: Boolean(env.AHREFS_API_KEY),
        endpoint: "/check-dr",
      });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return jsonResponse({
        ok: true,
        service: "bulk-dr-checker",
        endpoints: {
          health: "/health",
          check: "/check-dr",
        },
      });
    }

    if (url.pathname === "/check-dr" && request.method === "POST") {
      return handleCheck(request, env);
    }

    return jsonResponse({ success: false, error: "Not Found" }, 404);
  },
};
