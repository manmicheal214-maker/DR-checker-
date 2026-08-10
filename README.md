# Bulk Domain Rating Checker

A simple bulk SEO tool that allows users to check Ahrefs Domain Rating (DR) for up to 100 domains.

## Architecture

```text
GitHub Pages
     |
     | HTTPS POST
     v
Cloudflare Worker
     |
     | Secure API request
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

* Check up to 100 domains
* Automatic domain normalization
* Duplicate removal
* Domain validation
* Ahrefs Domain Rating results
* DR color visualization
* Average DR
* Successful/failed counts
* Search results
* Sort by domain, DR, or status
* CSV export
* Responsive design
* API key protected by Cloudflare Worker
* No database required

---

# 1. Create GitHub Repository

Create a new GitHub repository.

Example:

```text
bulk-dr-checker
```

Upload:

```text
index.html
style.css
script.js
README.md
worker/worker.js
```

Do NOT put your Ahrefs API key anywhere in these GitHub files.

---

# 2. Enable GitHub Pages

Open:

```text
Repository
→ Settings
→ Pages
```

Under:

```text
Build and deployment
```

Select:

```text
Deploy from a branch
```

Choose:

```text
Branch: main
Folder: / (root)
```

Save.

GitHub will provide a URL similar to:

```text
https://YOUR-USERNAME.github.io/bulk-dr-checker/
```

---

# 3. Create Cloudflare Worker

Create a Cloudflare account.

Create a new Worker.

Copy the contents of:

```text
worker/worker.js
```

into the Worker.

Deploy the Worker.

You will receive a URL similar to:

```text
https://bulk-dr-checker.YOUR-SUBDOMAIN.workers.dev
```

---

# 4. Add Ahrefs API Secret

In Cloudflare Worker settings, add a secret:

```text
AHREFS_API_KEY
```

Value:

```text
YOUR_AHREFS_API_KEY
```

Never put this value into:

```text
index.html
script.js
```

or any GitHub file.

---

# 5. Configure Allowed Origin

Add a Worker environment variable:

```text
ALLOWED_ORIGIN
```

Set it to your GitHub Pages URL.

Example:

```text
https://YOUR-USERNAME.github.io
```

If your project is:

```text
https://YOUR-USERNAME.github.io/bulk-dr-checker/
```

the origin is:

```text
https://YOUR-USERNAME.github.io
```

Do not include the `/bulk-dr-checker/` path in `ALLOWED_ORIGIN`.

---

# 6. Configure Frontend

Open:

```text
script.js
```

Find:

```javascript
const API_URL = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/check-dr";
```

Replace it with your actual Cloudflare Worker endpoint.

Example:

```javascript
const API_URL =
  "https://bulk-dr-checker.example.workers.dev/check-dr";
```

Commit the change.

---

# 7. Test

Open your GitHub Pages website.

Paste:

```text
example.com
ahrefs.com
google.com
hubspot.com
```

Click:

```text
Check DR
```

The browser sends the domains to Cloudflare Worker.

Cloudflare Worker sends the authenticated request to Ahrefs.

The API key never reaches the browser.

---

# Security

The Ahrefs API key MUST remain inside the Cloudflare Worker secret.

Never do this:

```javascript
const AHREFS_API_KEY = "your-key";
```

inside the GitHub Pages frontend.

Never commit an API key to GitHub.

If an API key is accidentally committed, revoke it immediately and create a new key.

---

# Ahrefs API

This project uses the Ahrefs Batch Analysis API.

Before production deployment, verify the current Ahrefs API documentation for:

* endpoint
* authentication
* request body
* target format
* selected metrics
* response format
* API limits
* pricing/usage
* licensing requirements

The API implementation is intentionally isolated in:

```text
worker/worker.js
```

The response parser is isolated in:

```text
parseAhrefsResults()
```

This makes future Ahrefs API changes easier to implement.

---

# Local Frontend Testing

Because the frontend calls the Cloudflare Worker, it is best to serve the files through a local HTTP server rather than opening `index.html` directly.

For example, with Python:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Remember that the Cloudflare Worker CORS configuration must allow your local development origin if you want to test locally.

---

# CSV

Results can be exported as:

```text
bulk-dr-results-YYYY-MM-DD.csv
```

Example:

```csv
Domain,Domain Rating,Status
example.com,72.5,Success
ahrefs.com,91,Success
example.org,,Not Found
```

---

# Troubleshooting

## "Please configure your Cloudflare Worker URL"

Open:

```text
script.js
```

and replace the placeholder Worker URL.

---

## "Ahrefs API authentication failed"

Check:

```text
AHREFS_API_KEY
```

in Cloudflare Worker secrets.

Do not put the key in GitHub.

---

## CORS error

Check:

```text
ALLOWED_ORIGIN
```

in Cloudflare.

For GitHub Pages:

```text
https://YOUR-USERNAME.github.io
```

---

## Ahrefs API request failed

Check the current Ahrefs API documentation and verify the request schema in:

```text
worker/worker.js
```

The Batch Analysis API schema can change, so the request and response parser may need updating.

---

# Future Improvements

Possible future features:

* 1,000+ domain processing through queued batches
* User accounts
* Saved projects
* DR history
* Historical charts
* Scheduled checks
* Email alerts
* Google Sheets export
* Excel export
* Backlink metrics
* Referring domains
* Organic traffic
* Competitor comparison
* API access for your own users
* Usage limits
* Payment/subscription system

---

## License

This project is provided as a starter implementation.

Review Ahrefs API terms, licensing requirements, and attribution requirements before using the application commercially.
