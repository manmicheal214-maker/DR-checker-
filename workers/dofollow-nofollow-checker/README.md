# CheckDR Bulk Dofollow/Nofollow Link Checker Worker

## Deploy

From this directory:

1. Install Wrangler if needed: `npm install --save-dev wrangler` (or use `npx wrangler`).
2. Create a Cloudflare Turnstile widget for `checkdr.net` and `www.checkdr.net`. Set the public site key in `wrangler.toml` as `TURNSTILE_SITE_KEY` **and** replace `[TURNSTILE_SITE_KEY]` in `/tools/dofollow-nofollow-checker.js` with that same public key.
3. Set the private secret interactively: `npx wrangler secret put TURNSTILE_SECRET`. Do not commit the secret.
4. Deploy: `npx wrangler deploy`.
5. Copy the deployed Worker URL into `WORKER_URL` in `/tools/dofollow-nofollow-checker.js`.
6. Add the Worker URL to the tool page configuration and test from the production origin.

The `RATE_LIMITER` binding uses Cloudflare's Rate Limiting API, configured for 60 requests per 10 minutes per client IP. Confirm your account supports Rate Limiting bindings on the selected plan before deploying.

## Endpoint

`GET /check?url=<page-url>&target=<optional-domain>&token=<Turnstile-token>`

The Worker accepts only requests whose Origin exactly matches `ALLOWED_ORIGINS`, verifies Turnstile server-side, validates public HTTP(S) URLs, manually validates redirects, and parses HTML with HTMLRewriter. Successful parsed results are cached for five minutes. It returns structured JSON, never source HTML.

## Security notes

- The Worker blocks localhost, common private/reserved IP literals, and `.local` hostnames. Cloudflare's standard fetch API does not expose a reliable resolved-IP pinning primitive for arbitrary hostnames; a public hostname that changes DNS answers between validation and connection remains a residual SSRF risk. Review this threat model before production use.
- Responses with 401, 403, or 429 are reported as `blocked`.
- The stream reader aborts at 2 MiB and returns `too_large`.
- Set the site key and secret only in the intended Cloudflare configuration; never commit secrets.

## Automated checks

The pull-request workflow runs npm test, checks the Worker and parser module syntax, and checks the frontend JavaScript syntax.

## Manual test checklist

- [ ] Check 10 URLs; rows should finish progressively, with no more than four active calls.
- [ ] A `rel="nofollow sponsored"` link displays both type badges.
- [ ] `<meta name="robots" content="nofollow">` shows the page-level warning without changing link types.
- [ ] Relative links resolve against the final redirect URL and honor `<base href>`.
- [ ] 403 response shows “Blocked” and offers the paste-HTML fallback.
- [ ] Unlisted Origin and invalid/missing Turnstile tokens are rejected.
- [ ] localhost, private IPs, and `.local` URLs are rejected.
- [ ] Filters, text search, CSV export, retry, and mobile layout work.
