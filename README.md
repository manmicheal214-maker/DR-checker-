# Bulk Domain Rating Checker

A simple bulk SEO tool that checks Ahrefs Domain Rating (DR) for up to 100 domains.

## Architecture

```text
GitHub Pages
     |
     | HTTPS POST
     v
Cloudflare Worker
     |
     | Authenticated requests (5 concurrent, 1 domain/request)
     v
Ahrefs Batch Analysis API
     |
     v
Cloudflare Worker
     |
     v
GitHub Pages
     |
     v
Results + CSV
```

## Features

- Check up to 100 domains
- Automatic domain normalization and duplicate removal
- Domain validation
- Concurrent Ahrefs requests with bounded concurrency
- Retry handling for rate limits and transient 5xx errors
- Request timeouts
- Average DR and success/failure counts
- Search and sort results
- Pagination
- CSV export
- Responsive design
- Ahrefs API key protected by a Cloudflare Worker
- No database required

## Files

```text
index.html   # GitHub Pages frontend
script.js    # Frontend behavior and API client
style.css    # Frontend styles
worker.js    # Cloudflare Worker API
README.md    # Setup and usage documentation
```

## 1. Enable GitHub Pages

In the repository settings, open **Pages** and select **Deploy from a branch**, then choose the `main` branch and `/ (root)` folder.

GitHub will provide a URL similar to:

```text
https://YOUR-USERNAME.github.io/REPOSITORY-NAME/
```

## 2. Create the Cloudflare Worker

Create a Cloudflare Worker and deploy the contents of `worker.js`.

The Worker exposes:

```text
POST /check-dr
```

## 3. Configure Worker secrets and variables

Create the following Worker secret:

```text
AHREFS_API_KEY
```

Create the following Worker environment variable:

```text
ALLOWED_ORIGIN
```

Set `ALLOWED_ORIGIN` to the **origin only**, without a path. For example:

```text
https://YOUR-USERNAME.github.io
```

`ALLOWED_ORIGIN` is required. The Worker rejects browser requests from other origins.

Never put the Ahrefs API key in `index.html`, `script.js`, or any other GitHub Pages file.

## 4. Configure the frontend

Set `API_URL` in `script.js` to your deployed Worker endpoint:

```javascript
const API_URL = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/check-dr";
```

## 5. Test

Paste one domain per line, for example:

```text
example.com
ahrefs.com
google.com
hubspot.com
```

Click **Check DR**.

The frontend sends all domains in one request. The Worker validates and deduplicates them, then checks domains concurrently with a bounded pool so large requests complete much faster than fully sequential processing.

## Security

The Ahrefs API key must remain inside the Cloudflare Worker secret store.

Never commit an API key to GitHub. If one is accidentally exposed, revoke it immediately and create a replacement.

The Worker also requires an explicit `ALLOWED_ORIGIN` and does not use a wildcard CORS fallback.

## Ahrefs API

This project uses the Ahrefs Batch Analysis API. Before production use, verify the current Ahrefs documentation for endpoint, authentication, request schema, response schema, limits, pricing, licensing, and attribution requirements.

The Worker isolates the Ahrefs request and response parsing so API changes can be handled without changing the frontend.

## Local Frontend Testing

Serve the frontend over HTTP instead of opening `index.html` directly. For example:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

For local browser testing, set `ALLOWED_ORIGIN` to the exact local origin (`http://localhost:8000`) while testing, then restore the production GitHub Pages origin.

## CSV

Results can be exported as:

```text
bulk-dr-results-YYYY-MM-DD.csv
```

The export includes:

```csv
Domain,Domain Rating,Status
example.com,72.5,Success
ahrefs.com,91,Success
example.org,,Not Found
```

## Troubleshooting

### "ALLOWED_ORIGIN is not configured"

Add the `ALLOWED_ORIGIN` Worker environment variable and redeploy if required by your deployment setup.

### "Origin is not allowed"

Make sure the browser origin exactly matches `ALLOWED_ORIGIN`, including `https://` and excluding any path.

### "Ahrefs API authentication failed"

Check the `AHREFS_API_KEY` Worker secret. Do not put the key in GitHub.

### "Ahrefs API rate limit reached"

The Worker retries 429 responses using the API's `Retry-After` header when available. Large requests may still be limited by the Ahrefs account's quota or rate limits.

### Request timeout

The frontend allows up to 90 seconds for a bulk request. If a request still times out, retry with fewer domains or inspect the Worker and Ahrefs API logs.

## Future Improvements

Possible future features include queued jobs for very large lists, saved projects, DR history, scheduled checks, additional Ahrefs metrics, usage limits, and authentication for multi-user deployments.

## License

This project is provided as a starter implementation. Review Ahrefs API terms, licensing requirements, and attribution requirements before using the application commercially.
