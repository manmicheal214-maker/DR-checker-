/**
 * Cloudflare Worker - Bulk DR Checker
 *
 * Required secret:
 *   AHREFS_API_KEY
 *
 * The worker uses Ahrefs' Domain Rating Free endpoint. As of
 * August 10, 2026, Ahrefs requires an API key for this endpoint.
 */

const AHREFS_ENDPOINT = "https://api.ahrefs.com/v3/public/domain-rating-free";
const MAX_DOMAINS = 100;
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const MAX_RETRY_MS = 10000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

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

  if (!Number.isFinite(rating)) {
    return {
      domain,
      domain_rating: null,
      status: "not_found",
    };
  }

  return {
    domain,
    domain_rating: rating,
    status: "success",
  };
}

async function checkDomain(domain, apiKey) {
  try {
    const url = new URL(AHREFS_ENDPOINT);
    url.searchParams.set("target", `https://${domain}`);
    url.searchParams.set("output", "json");

    const response = await fetchWithRetry(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Ahrefs API error", response.status, data);

      let error = "Ahrefs API request failed.";
      if (response.status === 401) {
        error = "Ahrefs API authentication failed. Check AHREFS_API_KEY.";
      } else if (response.status === 403) {
        error = "Ahrefs API access was denied. Check your Ahrefs account/API permissions.";
      } else if (response.status === 429) {
        error = "Ahrefs API rate limit reached. Please try again later.";
      } else if (response.status >= 500) {
        error = "Ahrefs API is temporarily unavailable.";
      } else if (data?.error?.message) {
        error = `Ahrefs API: ${data.error.message}`;
      } else if (data?.message) {
        error = `Ahrefs API: ${data.message}`;
      }

      return {
        domain,
        domain_rating: null,
        status: "failed",
        error,
      };
    }

    return parseResult(domain, data);
  } catch (error) {
    console.error("Domain check failed", domain, error?.message || error);

    return {
      domain,
      domain_rating: null,
      status: "failed",
      error:
        error?.name === "AbortError"
          ? "Ahrefs request timed out."
          : "Unable to connect to Ahrefs.",
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
    return jsonResponse(
      {
        success: false,
        error: "AHREFS_API_KEY is not configured in Cloudflare Workers.",
      },
      500
    );
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
    return jsonResponse(
      {
        success: false,
        error: `Maximum ${MAX_DOMAINS} domains are allowed.`,
      },
      400
    );
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
    return jsonResponse(
      {
        success: false,
        error: "No valid domains were provided.",
        invalid_domains: invalidDomains,
      },
      400
    );
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
        ahrefsEndpoint: "/v3/public/domain-rating-free",
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
