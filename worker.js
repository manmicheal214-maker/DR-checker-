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

const AHREFS_ENDPOINT =
"https://api.ahrefs.com/v3/batch-analysis/batch-analysis";

const MAX_DOMAINS = 100;

function corsHeaders(origin, allowedOrigin) {
const allowed =
allowedOrigin === "*" || origin === allowedOrigin
? origin
: allowedOrigin;

return {
"Access-Control-Allow-Origin": allowed,
"Access-Control-Allow-Methods": "POST, OPTIONS",
"Access-Control-Allow-Headers": "Content-Type",
"Vary": "Origin"
};
}

function jsonResponse(
data,
status,
request,
env
) {
const origin = request.headers.get("Origin") || "";

return new Response(
JSON.stringify(data),
{
status,
headers: {
"Content-Type": "application/json; charset=utf-8",
...corsHeaders(
origin,
env.ALLOWED_ORIGIN || "*"
)
}
}
);
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
if (!/^https?:///i.test(input)) {
input = "https://" + input;
}

```
const url = new URL(input);

let hostname = url.hostname.toLowerCase();

if (hostname.startsWith("www.")) {
  hostname = hostname.substring(4);
}

return hostname;
```

} catch {
return null;
}
}

function isValidDomain(domain) {
if (!domain || domain.length > 253) {
return false;
}

return /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}.)+[a-zA-Z]{2,63}$/.test(
domain
);
}

async function handleCheckDr(request, env) {
let body;

try {
body = await request.json();
} catch {
return jsonResponse(
{
success: false,
error: "Invalid JSON request."
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
error: "domains must be an array."
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
error: `Maximum ${MAX_DOMAINS} domains are allowed.`
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

```
if (!domain || !isValidDomain(domain)) {
  invalidDomains.push(String(item));
  continue;
}

validDomains.push(domain);
```

}

const domains = [...new Set(validDomains)];

if (domains.length === 0) {
return jsonResponse(
{
success: false,
error: "No valid domains were provided."
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
error: "Ahrefs API key is not configured on the server."
},
500,
request,
env
);
}

/*

* Ahrefs Batch Analysis request.
*
* Verify the current Ahrefs API documentation for the exact
* request schema available to your account before production use.
  */

const ahrefsPayload = {
select: [
"domain_rating"
],
targets: domains.map(domain => ({
url: domain,
mode: "domain",
protocol: "both"
})),
output: "json"
};

let ahrefsResponse;

try {
ahrefsResponse = await fetch(
AHREFS_ENDPOINT,
{
method: "POST",
headers: {
"Authorization":
`Bearer ${env.AHREFS_API_KEY}`,
"Content-Type":
"application/json",
"Accept":
"application/json"
},
body: JSON.stringify(
ahrefsPayload
)
}
);
} catch (error) {
console.error(
"Ahrefs request failed:",
error
);

```
return jsonResponse(
  {
    success: false,
    error:
      "Unable to connect to the Ahrefs API."
  },
  502,
  request,
  env
);
```

}

let ahrefsData;

try {
ahrefsData =
await ahrefsResponse.json();
} catch {
return jsonResponse(
{
success: false,
error:
"Ahrefs returned an invalid response."
},
502,
request,
env
);
}

if (!ahrefsResponse.ok) {
console.error(
"Ahrefs API error:",
ahrefsResponse.status,
ahrefsData
);

```
let message =
  "Ahrefs API request failed.";

if (ahrefsResponse.status === 401) {
  message =
    "Ahrefs API authentication failed.";
}

if (ahrefsResponse.status === 429) {
  message =
    "Ahrefs API rate limit reached. Please try again later.";
}

return jsonResponse(
  {
    success: false,
    error: message
  },
  ahrefsResponse.status,
  request,
  env
);
```

}

/*

* Convert the Ahrefs response into our own simple response.
*
* Batch Analysis response formats can change.
* Keep this parser isolated so it is easy to update.
  */

const results = parseAhrefsResults(
ahrefsData,
domains
);

return jsonResponse(
{
success: true,
results,
invalid_domains: invalidDomains
},
200,
request,
env
);
}

function parseAhrefsResults(
data,
requestedDomains
) {
/*

* Attempt to support common Batch Analysis
* response structures.
*
* IMPORTANT:
* Check the current Ahrefs documentation and
* adjust this function if your API response
* uses a different structure.
  */

let rows = [];

if (Array.isArray(data)) {
rows = data;
} else if (Array.isArray(data.results)) {
rows = data.results;
} else if (Array.isArray(data.data)) {
rows = data.data;
} else if (Array.isArray(data.targets)) {
rows = data.targets;
}

const map = new Map();

for (const row of rows) {
const rawUrl =
row.url ||
row.target ||
row.domain ||
row.input;

```
const domain =
  normalizeDomain(rawUrl);

if (!domain) {
  continue;
}

const rawDr =
  row.domain_rating ??
  row.domainRating ??
  row.dr ??
  row.DomainRating;

const dr =
  rawDr === null ||
  rawDr === undefined ||
  rawDr === ""
    ? null
    : Number(rawDr);

map.set(
  domain,
  {
    domain,
    domain_rating:
      Number.isFinite(dr)
        ? dr
        : null,
    status:
      Number.isFinite(dr)
        ? "success"
        : "not_found"
  }
);
```

}

return requestedDomains.map(
domain =>
map.get(domain) || {
domain,
domain_rating: null,
status: "not_found"
}
);
}

export default {
async fetch(request, env) {
const origin =
request.headers.get("Origin") || "";

```
if (request.method === "OPTIONS") {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(
      origin,
      env.ALLOWED_ORIGIN || "*"
    )
  });
}

const url =
  new URL(request.url);

if (
  url.pathname === "/check-dr" &&
  request.method === "POST"
) {
  return handleCheckDr(
    request,
    env
  );
}

return jsonResponse(
  {
    success: false,
    error: "Not Found"
  },
  404,
  request,
  env
);
```

}
};
