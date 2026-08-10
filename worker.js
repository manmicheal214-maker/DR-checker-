/**
 * Cloudflare Worker
 * Bulk Domain Rating Checker
 *
 * Required Worker secrets:
 *
 * AHREFS_API_KEY
 *
 * Required environment variable:
 *
 * ALLOWED_ORIGIN
 *
 * Example:
 *
 * ALLOWED_ORIGIN=https://YOUR-USERNAME.github.io
 */

const AHREFS_ENDPOINT = "https://api.ahrefs.com/v3/batch-analysis/batch-analysis";

const MAX_DOMAINS = 100;
const FETCH_TIMEOUT_MS = 30000;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

function corsHeaders(origin, allowedOrigin) {
  const allowed =
    allowedOrigin === "*" || origin === allowedOrigin ? origin : allowedOrigin;

  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function jsonResponse(data, status, request, env) {
  const origin = request.headers.get("Origin") || "";

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin, env.ALLOWED_ORIGIN || "*"),
    },
  });
}

function normalizeDomain(value) {
  if (typeof value !== "string") {
    return null;
  }

  let input = value.trim();

  if (!input) {
    return null;
  }

  try {
    if (!/^https?:\/\//i.test(input)) {
      input = "https://" + input;
    }

    const url = new URL(input);
    let hostname = url.hostname.toLowerCase();

    if (hostname.startsWith("www.")) {
      hostname = hostname.substring(4);
    }

    return hostname;
  } catch {
    return null;
  }
}

function isValidDomain(domain) {
  if (!domain || domain.length > 253) {
    return false;
  }

  return /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/.test(
    domain
  );
}

/**
 * Retry logic with exponential backoff
 */
async function fetchWithRetry(url, options, attempt = 1) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      FETCH_TIMEOUT_MS
    );

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    if (attempt < RETRY_MAX_ATTEMPTS) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, attempt + 1);
    }

    throw error;
  }
}

/**
 * Check a SINGLE domain with Ahrefs API
 * Ahrefs allows only 1 domain per request
 */
async function checkSingleDomain(domain, apiKey) {
  const ahrefsPayload = {
    select: ["domain_rating"],
    targets: [
      {
        url: domain,
        mode: "domain",
        protocol: "both",
      },
    ],
    output: "json",
  };

  const ahrefsResponse = await fetchWithRetry(AHREFS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(ahrefsPayload),
  });

  if (!ahrefsResponse.ok) {
    const errorData = await ahrefsResponse.json().catch(() => ({}));

    console.error(
      `Ahrefs API error for ${domain}:`,
      ahrefsResponse.status,
      errorData
    );

    let errorMsg = "Ahrefs API request failed.";
    if (ahrefsResponse.status === 401) {
      errorMsg = "Ahrefs API authentication failed.";
    } else if (ahrefsResponse.status === 429) {
      errorMsg = "Ahrefs API rate limit reached. Please try again later.";
    }

    return {
      domain,
      domain_rating: null,
      status: "failed",
      error: errorMsg,
    };
  }

  let ahrefsData;
  try {
    ahrefsData = await ahrefsResponse.json();
  } catch {
    console.error(`Failed to parse Ahrefs response for ${domain}`);
    return {
      domain,
      domain_rating: null,
      status: "failed",
      error: "Invalid Ahrefs response",
    };
  }

  return parseSingleDomainResult(domain, ahrefsData);
}

/**
 * Parse Ahrefs response for a single domain
 */
function parseSingleDomainResult(domain, data) {
  let row = null;

  // Try different response structures
  if (Array.isArray(data)) {
    row = data[0];
  } else if (Array.isArray(data.results)) {
    row = data.results[0];
  } else if (Array.isArray(data.data)) {
    row = data.data[0];
  } else if (Array.isArray(data.targets)) {
    row = data.targets[0];
  } else if (data.targets && typeof data.targets === "object") {
    // Single object response
    row = data.targets;
  } else {
    row = data;
  }

  if (!row) {
    return {
      domain,
      domain_rating: null,
      status: "not_found",
    };
  }

  // Extract DR value from various possible field names
  const rawDr =
    row.domain_rating ??
    row.domainRating ??
    row.dr ??
    row.DomainRating ??
    row.metrics?.domain_rating;

  const dr =
    rawDr === null || rawDr === undefined || rawDr === ""
      ? null
      : Number(rawDr);

  return {
    domain,
    domain_rating: Number.isFinite(dr) ? dr : null,
    status: Number.isFinite(dr) ? "success" : "not_found",
  };
}

async function handleCheckDr(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      400,
      request,
      env
    );
  }

  if (!body || !Array.isArray(body.domains)) {
    return jsonResponse(
      {
        success: false,
        error: "domains must be an array.",
      },
      400,
      request,
      env
    );
  }

  if (body.domains.length > MAX_DOMAINS) {
    return jsonResponse(
      {
        success: false,
        error: `Maximum ${MAX_DOMAINS} domains are allowed.`,
      },
      400,
      request,
      env
    );
  }

  const validDomains = [];
  const invalidDomains = [];

  for (const item of body.domains) {
    const domain = normalizeDomain(item);

    if (!domain || !isValidDomain(domain)) {
      invalidDomains.push(String(item));
      continue;
    }

    validDomains.push(domain);
  }

  const domains = [...new Set(validDomains)];

  if (domains.length === 0) {
    return jsonResponse(
      {
        success: false,
        error: "No valid domains were provided.",
      },
      400,
      request,
      env
    );
  }

  if (!env.AHREFS_API_KEY) {
    return jsonResponse(
      {
        success: false,
        error: "Ahrefs API key is not configured on the server.",
      },
      500,
      request,
      env
    );
  }

  /**
   * Check each domain sequentially with timeout and retry logic
   * Ahrefs API allows only 1 domain per request
   */
  const results = [];

  for (const domain of domains) {
    try {
      const result = await checkSingleDomain(domain, env.AHREFS_API_KEY);
      results.push(result);

      // Small delay between requests to respect API rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error checking domain ${domain}:`, error.message);

      results.push({
        domain,
        domain_rating: null,
        status: "failed",
        error:
          error.message === "The operation was aborted"
            ? "Request timeout"
            : "Unable to connect to Ahrefs API",
      });
    }
  }

  return jsonResponse(
    {
      success: true,
      results,
      invalid_domains: invalidDomains,
    },
    200,
    request,
    env
  );
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env.ALLOWED_ORIGIN || "*"),
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/check-dr" && request.method === "POST") {
      return handleCheckDr(request, env);
    }

    return jsonResponse(
      {
        success: false,
        error: "Not Found",
      },
      404,
      request,
      env
    );
  },
};
