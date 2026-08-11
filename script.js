/*
 * Bulk DR Checker
 */

const API_URL = "https://bulk-dr-checker.manmicheal214.workers.dev/check-dr";
const MAX_DOMAINS = 100;
const RESULTS_PER_PAGE = 25;
const SEARCH_DEBOUNCE_MS = 250;
const FETCH_TIMEOUT_MS = 90000;

const domainInput = document.getElementById("domainInput");
const domainCounter = document.getElementById("domainCounter");
const checkButton = document.getElementById("checkButton");
const clearButton = document.getElementById("clearButton");
const downloadButton = document.getElementById("downloadButton");
const loading = document.getElementById("loading");
const summary = document.getElementById("summary");
const resultsSection = document.getElementById("resultsSection");
const errorCard = document.getElementById("errorCard");
const serverError = document.getElementById("serverError");
const inputError = document.getElementById("inputError");
const resultsBody = document.getElementById("resultsBody");
const searchInput = document.getElementById("searchInput");
const paginationContainer = document.getElementById("paginationContainer");
const totalCount = document.getElementById("totalCount");
const successCount = document.getElementById("successCount");
const failedCount = document.getElementById("failedCount");
const averageDr = document.getElementById("averageDr");

let allResults = [];
let filteredResults = [];
let sortColumn = "domain_rating";
let sortDirection = "desc";
let currentPage = 1;
let searchDebounceTimer = null;
let activeController = null;

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
  return labels.length >= 2 && labels.every((label) =>
    label.length >= 1 && label.length <= 63 &&
    !label.startsWith("-") && !label.endsWith("-") &&
    /^[a-zA-Z0-9-]+$/.test(label)
  );
}

function getDomainsFromInput() {
  const valid = [];
  const invalid = [];
  for (const line of domainInput.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const domain = normalizeDomain(line);
    if (!domain || !isValidDomain(domain)) invalid.push(line);
    else valid.push(domain);
  }
  return { domains: [...new Set(valid)], invalid };
}

function updateCounter() {
  const { domains } = getDomainsFromInput();
  const overLimit = domains.length > MAX_DOMAINS;
  domainCounter.textContent = `${domains.length} / ${MAX_DOMAINS}`;
  domainCounter.toggleAttribute("data-over-limit", overLimit);
}

function showInputError(message) {
  inputError.textContent = message;
  inputError.classList.remove("hidden");
}
function hideInputError() {
  inputError.textContent = "";
  inputError.classList.add("hidden");
}
function showServerError(message) {
  serverError.textContent = message;
  errorCard.classList.remove("hidden");
}
function hideServerError() {
  serverError.textContent = "";
  errorCard.classList.add("hidden");
}
function setLoading(value) {
  loading.classList.toggle("hidden", !value);
  loading.setAttribute("aria-busy", String(value));
  checkButton.disabled = value;
  clearButton.disabled = value;
  downloadButton.disabled = value;
}

function getDrClass(dr) {
  if (typeof dr !== "number") return "";
  if (dr <= 10) return "dr-low";
  if (dr <= 30) return "dr-medium-low";
  if (dr <= 50) return "dr-medium";
  if (dr <= 70) return "dr-good";
  if (dr <= 90) return "dr-high";
  return "dr-excellent";
}
function getStatusClass(status) {
  if (status === "success") return "status-success";
  if (status === "not_found") return "status-not-found";
  return "status-failed";
}
function displayStatus(status) {
  if (status === "success") return "Success";
  if (status === "not_found") return "Not Found";
  if (status === "failed") return "Failed";
  return status || "Unknown";
}

function createResultRow(result, index) {
  const row = document.createElement("tr");
  const numberCell = document.createElement("td");
  numberCell.textContent = String(index + 1);
  const domainCell = document.createElement("td");
  domainCell.className = "domain-cell";
  domainCell.textContent = result.domain || "—";
  const drCell = document.createElement("td");
  if (typeof result.domain_rating === "number") {
    const badge = document.createElement("span");
    badge.className = `dr-badge ${getDrClass(result.domain_rating)}`;
    badge.textContent = String(result.domain_rating);
    drCell.appendChild(badge);
  } else drCell.textContent = "—";
  const statusCell = document.createElement("td");
  const status = document.createElement("span");
  status.className = `status ${getStatusClass(result.status)}`;
  status.textContent = displayStatus(result.status);
  statusCell.appendChild(status);
  row.append(numberCell, domainCell, drCell, statusCell);
  return row;
}

function renderResults() {
  const startIndex = (currentPage - 1) * RESULTS_PER_PAGE;
  const pageResults = filteredResults.slice(startIndex, startIndex + RESULTS_PER_PAGE);
  const fragment = document.createDocumentFragment();
  pageResults.forEach((result, index) => fragment.appendChild(createResultRow(result, startIndex + index)));
  resultsBody.replaceChildren(fragment);
  renderPagination();
}

function renderPagination() {
  paginationContainer.replaceChildren();
  const totalPages = Math.ceil(filteredResults.length / RESULTS_PER_PAGE);
  if (totalPages <= 1) return;
  const nav = document.createElement("div");
  nav.className = "pagination";
  const createButton = (label, disabled, nextPage) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pagination-btn";
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", () => {
      currentPage = nextPage;
      renderResults();
      resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return button;
  };
  nav.appendChild(createButton("← Previous", currentPage === 1, currentPage - 1));
  const pageInfo = document.createElement("span");
  pageInfo.className = "page-info";
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  nav.appendChild(pageInfo);
  nav.appendChild(createButton("Next →", currentPage === totalPages, currentPage + 1));
  paginationContainer.appendChild(nav);
}

function updateSummary() {
  const successful = allResults.reduce((count, result) => count + (result.status === "success" ? 1 : 0), 0);
  const failed = allResults.length - successful;
  const ratings = allResults.filter((result) => typeof result.domain_rating === "number");
  const average = ratings.length ? ratings.reduce((sum, result) => sum + result.domain_rating, 0) / ratings.length : null;
  totalCount.textContent = String(allResults.length);
  successCount.textContent = String(successful);
  failedCount.textContent = String(failed);
  averageDr.textContent = average === null ? "—" : average.toFixed(1);
}

function applyFilterAndSort() {
  const query = searchInput.value.trim().toLowerCase();
  filteredResults = allResults.filter((result) => String(result.domain || "").toLowerCase().includes(query)).sort((a, b) => {
    let valueA = a[sortColumn];
    let valueB = b[sortColumn];
    if (sortColumn === "domain_rating") {
      valueA = typeof valueA === "number" ? valueA : -1;
      valueB = typeof valueB === "number" ? valueB : -1;
    } else {
      valueA = String(valueA ?? "").toLowerCase();
      valueB = String(valueB ?? "").toLowerCase();
    }
    if (valueA === valueB) return 0;
    const comparison = valueA < valueB ? -1 : 1;
    return sortDirection === "asc" ? comparison : -comparison;
  });
  currentPage = 1;
  renderResults();
}
function debouncedSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(applyFilterAndSort, SEARCH_DEBOUNCE_MS);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  if (activeController) activeController.abort();
  activeController = new AbortController();
  const timeoutId = setTimeout(() => activeController.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: activeController.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The request timed out. Please try again with fewer domains.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
    activeController = null;
  }
}

async function checkDomains() {
  hideInputError();
  hideServerError();
  const { domains, invalid } = getDomainsFromInput();
  if (!domains.length) return showInputError("Please enter at least one valid domain.");
  if (domains.length > MAX_DOMAINS) return showInputError(`You can check a maximum of ${MAX_DOMAINS} domains.`);
  if (invalid.length) showInputError(`${invalid.length} invalid domain(s) were skipped.`);
  if (!API_URL || API_URL.includes("YOUR-WORKER")) return showServerError("Please configure your Cloudflare Worker URL in script.js.");

  setLoading(true);
  try {
    const response = await fetchWithTimeout(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domains }),
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("The server returned an invalid response."); }
    if (!response.ok) throw new Error(data?.error || `Request failed with HTTP ${response.status}.`);
    if (!data.success || !Array.isArray(data.results)) throw new Error("The server returned an unexpected response.");
    allResults = data.results;
    updateSummary();
    applyFilterAndSort();
    summary.classList.remove("hidden");
    resultsSection.classList.remove("hidden");
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error(error);
    const message = error.message === "Failed to fetch"
      ? "Unable to reach the checker API. Please verify the Cloudflare Worker URL and ALLOWED_ORIGIN setting."
      : (error.message || "Unable to check the domains. Please try again.");
    showServerError(message);
  } finally {
    setLoading(false);
  }
}

function clearAll() {
  if (activeController) activeController.abort();
  domainInput.value = "";
  searchInput.value = "";
  allResults = [];
  filteredResults = [];
  currentPage = 1;
  summary.classList.add("hidden");
  resultsSection.classList.add("hidden");
  hideInputError();
  hideServerError();
  resultsBody.replaceChildren();
  paginationContainer.replaceChildren();
  updateCounter();
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function downloadCsv() {
  if (!allResults.length) return;
  const rows = [["Domain", "Domain Rating", "Status"]];
  for (const result of allResults) rows.push([result.domain, result.domain_rating ?? "", displayStatus(result.status)]);
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bulk-dr-results-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

domainInput.addEventListener("input", updateCounter);
checkButton.addEventListener("click", checkDomains);
clearButton.addEventListener("click", clearAll);
downloadButton.addEventListener("click", downloadCsv);
searchInput.addEventListener("input", debouncedSearch);
document.querySelectorAll(".sortable").forEach((header) => {
  header.addEventListener("click", () => {
    const column = header.dataset.sort;
    if (sortColumn === column) sortDirection = sortDirection === "asc" ? "desc" : "asc";
    else {
      sortColumn = column;
      sortDirection = column === "domain_rating" ? "desc" : "asc";
    }
    applyFilterAndSort();
  });
});
updateCounter();
