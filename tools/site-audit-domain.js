const apiBase = "https://bulk-dr-checker.manmicheal214.workers.dev";
const $ = (id) => document.getElementById(id);
const domainInput = $("auditDomain");
const discoverButton = $("discoverRun");
const clearButton = $("auditClear");
const loading = $("auditLoading");
const loadingTitle = $("auditLoadingTitle");
const loadingText = $("auditLoadingText");
const errorPanel = $("auditError");
const errorText = $("auditErrorText");
const discoveryPanel = $("discoveryPanel");
const discoverySummary = $("discoverySummary");
const sitemapNote = $("sitemapNote");
const pageChoices = $("pageChoices");
const runAuditButton = $("runAudit");
const reportPanel = $("reportPanel");
const summaryMetrics = $("summaryMetrics");
const issueTally = $("issueTally");
const issueList = $("issueList");
const auditRows = $("auditRows");
const reportContext = $("reportContext");
const domainChecks = $("domainChecks");
let discovered = [];
let discoveredTotal = 0;
let lastRows = [];
let lastDomain = "";

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function showError(message) {
  errorText.textContent = message;
  errorPanel.classList.remove("hidden");
}
function resetError() { errorPanel.classList.add("hidden"); errorText.textContent = ""; }
function setLoading(on, title = "Working…", message = "Contacting the Worker.") {
  loadingTitle.textContent = title;
  loadingText.textContent = message;
  loading.classList.toggle("hidden", !on);
  discoverButton.disabled = on;
  runAuditButton.disabled = on;
}
async function post(endpoint, body) {
  const response = await fetch(apiBase + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 429) throw new Error(data.error || "Hourly limit reached for " + endpoint + ".");
  if (!response.ok || data.success === false) throw new Error(data.error || endpoint + " request failed.");
  return data;
}
function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}
async function safePost(endpoint, body) {
  try { return { data: await post(endpoint, body), error: null }; }
  catch (error) { return { data: null, error: error?.message || "Request failed." }; }
}
function renderChoices() {
  pageChoices.innerHTML = discovered.map((url, index) => `<label class="page-choice"><input type="checkbox" data-page-index="${index}" ${index < 15 ? "checked" : ""}><span>${esc(url)}</span></label>`).join("");
}
function selectedUrls() {
  return [...pageChoices.querySelectorAll("input[data-page-index]:checked")]
    .map((box) => discovered[Number(box.dataset.pageIndex)])
    .filter(Boolean);
}
function metric(label, value, detail = "") {
  return `<div class="audit-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;
}
function issue(text) { return `<li>${esc(text)}</li>`; }
function csvCell(value) {
  const s = String(value ?? "");
  return '"' + s.replace(/"/g, '""') + '"';
}
function downloadCsv() {
  const headers = ["URL", "Title length", "Description length", "Security headers present", "H1 count", "Reachability", "Canonical", "Check notes"];
  const lines = [headers, ...lastRows.map(r => [r.url, r.titleLength, r.descriptionLength, r.headerScore, r.h1Count, r.reachability, r.canonical, r.notes.join("; ")])];
  const blob = new Blob(["\uFEFF" + lines.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "site-audit-" + (lastDomain || "domain") + "-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function renderReport(rows, drResult, sslResult, linksResult, discovery) {
  lastRows = rows;
  const validHeaders = rows.filter(r => typeof r.headerScore === "number");
  const avgHeader = validHeaders.length ? (validHeaders.reduce((sum, r) => sum + r.headerScore, 0) / validHeaders.length).toFixed(1) + "/6" : "N/A";
  const titleIssues = rows.filter(r => typeof r.titleLength === "number" && (r.titleLength === 0 || r.titleLength > 60)).length;
  const descIssues = rows.filter(r => typeof r.descriptionLength === "number" && (r.descriptionLength === 0 || r.descriptionLength > 160)).length;
  const h1Issues = rows.filter(r => typeof r.h1Count === "number" && (r.h1Count === 0 || r.h1Count > 1)).length;
  const canonicalIssues = rows.filter(r => r.canonical === "").length;
  const dr = drResult?.domain_rating ?? "N/A";
  const ssl = sslResult?.error ? "Unavailable" : sslResult?.expired ? "Expired CT entry" : sslResult?.days_remaining != null ? (sslResult.days_remaining + " days in latest CT entry") : "N/A";
  summaryMetrics.innerHTML = metric("Domain Rating", dr, drResult?.status || drResult?.error || "") +
    metric("Certificate history", ssl, "CT logs; not a live TLS handshake") +
    metric("Average security headers", avgHeader, validHeaders.length + " pages with header results") +
    metric("Title length issues", titleIssues, "Missing or over 60 characters") +
    metric("Description length issues", descIssues, "Missing or over 160 characters") +
    metric("H1 issues", h1Issues, "Missing or multiple H1s") +
    metric("Missing canonical", canonicalIssues, "Selected pages without canonical tags");
  const issues = [];
  rows.forEach(r => {
    if (typeof r.titleLength === "number" && r.titleLength === 0) issues.push(r.url + ": missing title.");
    else if (typeof r.titleLength === "number" && r.titleLength > 60) issues.push(r.url + ": title exceeds 60 characters.");
    if (typeof r.descriptionLength === "number" && r.descriptionLength === 0) issues.push(r.url + ": missing meta description.");
    else if (typeof r.descriptionLength === "number" && r.descriptionLength > 160) issues.push(r.url + ": meta description exceeds 160 characters.");
    if (r.h1Count === 0) issues.push(r.url + ": no H1 heading found.");
    else if (typeof r.h1Count === "number" && r.h1Count > 1) issues.push(r.url + ": multiple H1 headings found (" + r.h1Count + ").");
    if (r.canonical === "") issues.push(r.url + ": missing canonical tag.");
    if (typeof r.headerScore === "number" && r.headerScore < 6) issues.push(r.url + ": " + (6 - r.headerScore) + " checked security header(s) missing.");
    if (r.reachability !== "Reachable" && !r.reachability.startsWith("Reachable (")) issues.push(r.url + ": reachability is " + r.reachability + ".");
    if (typeof r.httpStatus === "number" && r.httpStatus >= 400) issues.push(r.url + ": returned HTTP " + r.httpStatus + ".");
  });
  if (drResult?.error || drResult?.status !== "success") issues.push("Domain Rating check: " + (drResult?.error || drResult?.status || "unavailable") + ".");
  if (sslResult?.error) issues.push("Certificate history check: " + sslResult.error);
  if (linksResult?.error) issues.push("Homepage broken-link check: " + linksResult.error);
  else if (linksResult?.data) {
    const broken = (linksResult.data.results || []).filter(x => !x.ok && !x.skipped).length;
    if (broken) issues.push("Homepage: " + broken + " broken or unreachable link(s) among " + linksResult.data.checked_count + " checked.");
  }
  issueTally.textContent = issues.length + " individually identified issue(s). This is a count, not a composite score.";
  issueList.innerHTML = issues.length ? issues.map(issue).join("") : "<li>No issues were identified by the checks that completed.</li>";
  auditRows.innerHTML = rows.map(r => `<tr><td>${esc(r.url)}</td><td>${esc(r.titleLength)}</td><td>${esc(r.descriptionLength)}</td><td>${esc(r.headerScore == null ? "N/A" : r.headerScore + "/6")}</td><td>${esc(r.h1Count == null ? "N/A" : r.h1Count)}</td><td>${esc(r.reachability)}</td><td>${r.canonical == null ? "N/A" : r.canonical ? "Present" : "Missing"}</td><td>${esc(r.notes.join(" · ") || "—")}</td></tr>`).join("");
  reportContext.textContent = rows.length + " of " + discovery.total_urls_found + " sitemap-listed URLs audited for " + lastDomain + ".";
  domainChecks.innerHTML = `<p><strong>Domain Rating:</strong> ${esc(drResult?.domain_rating ?? "Unavailable")} — ${esc(drResult?.error || drResult?.status || "No result")}</p>
<p><strong>Certificate history:</strong> ${esc(sslResult?.error || (sslResult?.days_remaining != null ? (sslResult.days_remaining + " days remaining on latest CT entry") : "Unavailable"))}</p>
<p><strong>Homepage broken links:</strong> ${esc(linksResult?.error || (linksResult?.data ? (linksResult.data.checked_count + " links checked; " + (linksResult.data.results || []).filter(x => !x.ok && !x.skipped).length + " failed checks") : "Unavailable"))}</p>`;
  reportPanel.classList.remove("hidden");
}
discoverButton.addEventListener("click", async () => {
  resetError(); discoveryPanel.classList.add("hidden"); reportPanel.classList.add("hidden");
  const domain = domainInput.value.trim();
  if (!domain) return showError("Enter a domain such as example.com.");
  if (/^https?:\/\//i.test(domain) || domain.includes("/")) return showError("Enter a domain only, without a protocol, path, or query string.");
  setLoading(true, "Discovering sitemap", "Checking robots.txt and sitemap XML server-side.");
  try {
    const data = await post("/discover-sitemap", { domain });
    discovered = data.urls || [];
    lastDomain = data.domain || domain;
    if (!discovered.length) throw new Error("No sitemap URLs were returned.");
    discoveredTotal = data.total_urls_found || discovered.length;
    discoverySummary.textContent = discoveredTotal + " unique page URL(s) found. " + discovered.length + " shown for selection.";
    sitemapNote.textContent = "Sitemap used: " + (data.sitemap_url || "not reported") + (data.truncated ? " · Discovery was capped at 50 URLs." : "") + " The audit only covers pages included in the discovered sitemap.";
    renderChoices();
    discoveryPanel.classList.remove("hidden");
  } catch (error) { showError(error.message || "Sitemap discovery failed."); }
  finally { setLoading(false); }
});
$("selectFirst15").addEventListener("click", () => {
  pageChoices.querySelectorAll("input[data-page-index]").forEach((box, index) => { box.checked = index < 15; });
});
$("selectAll").addEventListener("click", () => pageChoices.querySelectorAll("input[data-page-index]").forEach(box => { box.checked = true; }));
$("selectNone").addEventListener("click", () => pageChoices.querySelectorAll("input[data-page-index]").forEach(box => { box.checked = false; }));
runAuditButton.addEventListener("click", async () => {
  resetError(); reportPanel.classList.add("hidden");
  const urls = selectedUrls();
  if (!urls.length) return showError("Select at least one page to audit.");
  setLoading(true, "Auditing selected pages", "Running metadata, security-header, and reachability checks in endpoint-sized batches.");
  try {
    const metaMap = new Map(), headersMap = new Map(), statusMap = new Map();
    const errors = [];
    for (const batch of chunks(urls, 8)) {
      const r = await safePost("/check-meta", { urls: batch });
      if (r.error) errors.push("Metadata: " + r.error);
      (r.data?.results || []).forEach(x => metaMap.set(x.url, x));
    }
    for (const batch of chunks(urls, 10)) {
      const r = await safePost("/check-headers", { urls: batch });
      if (r.error) errors.push("Security headers: " + r.error);
      (r.data?.results || []).forEach(x => headersMap.set(x.url, x));
    }
    for (const batch of chunks(urls, 10)) {
      const r = await safePost("/check-status", { urls: batch });
      if (r.error) errors.push("Reachability: " + r.error);
      (r.data?.results || []).forEach(x => statusMap.set(x.url, x));
    }
    const rows = urls.map(url => {
      const meta = metaMap.get(url), headers = headersMap.get(url), status = statusMap.get(url);
      const notes = [];
      if (!meta) notes.push("Metadata request unavailable");
      else if (meta.error) notes.push("Metadata: " + meta.error);
      if (!headers) notes.push("Headers request unavailable");
      else if (headers.error) notes.push("Headers: " + headers.error);
      if (!status) notes.push("Status request unavailable");
      else if (status.error) notes.push("Status: " + status.error);
      return {
        url,
        titleLength: !meta || meta.error ? null : (meta.title ? meta.title.length : 0),
        descriptionLength: !meta || meta.error ? null : (meta.description ? meta.description.length : 0),
        headerScore: typeof headers?.score === "number" ? headers.score : null,
        h1Count: !meta || meta.error ? null : (typeof meta.h1_count === "number" ? meta.h1_count : null),
        reachability: status?.ok ? ("Reachable" + (status.final_status ? " (" + status.final_status + ")" : "")) : status?.skipped ? "Skipped" : status ? ("Unreachable" + (status.final_status ? " (" + status.final_status + ")" : "")) : "Unavailable",
        canonical: !meta || meta.error ? null : (meta.canonical || ""),
        httpStatus: status?.final_status ?? null,
        notes
      };
    });
    const drRequest = safePost("/check-dr", { domains: [lastDomain] });
    const sslRequest = safePost("/check-ssl", { domains: [lastDomain] });
    const linksRequest = safePost("/check-links", { url: "https://" + lastDomain + "/" });
    const [drResponse, sslResponse, linksResult] = await Promise.all([drRequest, sslRequest, linksRequest]);
    if (errors.length) showError("Some batch requests failed; the report continues with partial results. " + errors.join(" · "));
    const drResult = drResponse.data?.results?.[0] || (drResponse.error ? { error: drResponse.error, status: "failed" } : null);
    const sslResult = sslResponse.data?.results?.[0] || (sslResponse.error ? { error: sslResponse.error } : null);
    renderReport(rows, drResult, sslResult, linksResult, { total_urls_found: discoveredTotal });
  } catch (error) {
    showError(error.message || "The audit could not be completed.");
  } finally { setLoading(false); }
});
$("exportAudit").addEventListener("click", downloadCsv);
clearButton.addEventListener("click", () => {
  domainInput.value = ""; discovered = []; discoveredTotal = 0; lastRows = []; lastDomain = "";
  discoveryPanel.classList.add("hidden"); reportPanel.classList.add("hidden"); resetError();
  pageChoices.replaceChildren(); domainInput.focus();
});
