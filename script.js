/*
 * Bulk DR Checker - Optimized
 *
 * IMPORTANT:
 * Change API_URL to your Cloudflare Worker URL.
 */

const API_URL = "https://bulk-dr-checker.manmicheal214.workers.dev/check-dr";

const MAX_DOMAINS = 100;
const RESULTS_PER_PAGE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const FETCH_TIMEOUT_MS = 30000;

// DOM Elements
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

const totalCount = document.getElementById("totalCount");
const successCount = document.getElementById("successCount");
const failedCount = document.getElementById("failedCount");
const averageDr = document.getElementById("averageDr");

// State
let allResults = [];
let filteredResults = [];
let sortColumn = "domain_rating";
let sortDirection = "desc";
let currentPage = 1;
let searchDebounceTimer = null;
let cachedSummary = null;

// ========== UTILITY FUNCTIONS ==========

function normalizeDomain(value) {
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

  const pattern =
    /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/;

  return pattern.test(domain);
}

function getDomainsFromInput() {
  const lines = domainInput.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const valid = [];
  const invalid = [];

  for (const line of lines) {
    const domain = normalizeDomain(line);

    if (!domain || !isValidDomain(domain)) {
      invalid.push(line);
      continue;
    }

    valid.push(domain);
  }

  const uniqueDomains = [...new Set(valid)];

  return {
    domains: uniqueDomains,
    invalid,
  };
}

function updateCounter() {
  const { domains } = getDomainsFromInput();

  domainCounter.textContent = `${domains.length} / ${MAX_DOMAINS}`;

  if (domains.length > MAX_DOMAINS) {
    domainCounter.style.color = "#dc2626";
    domainCounter.style.background = "#fee2e2";
  } else {
    domainCounter.style.color = "";
    domainCounter.style.background = "";
  }
}

// ========== ERROR HANDLING ==========

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
  checkButton.disabled = value;
  clearButton.disabled = value;
}

// ========== UI STYLING FUNCTIONS ==========

function getDrClass(dr) {
  if (typeof dr !== "number") {
    return "";
  }

  if (dr <= 10) return "dr-low";
  if (dr <= 30) return "dr-medium-low";
  if (dr <= 50) return "dr-medium";
  if (dr <= 70) return "dr-good";
  if (dr <= 90) return "dr-high";

  return "dr-excellent";
}

function getStatusClass(status) {
  switch (status) {
    case "success":
      return "status-success";
    case "not_found":
      return "status-not-found";
    default:
      return "status-failed";
  }
}

function displayStatus(status) {
  switch (status) {
    case "success":
      return "Success";
    case "not_found":
      return "Not Found";
    case "failed":
      return "Failed";
    default:
      return status || "Unknown";
  }
}

// ========== INCREMENTAL DOM RENDERING ==========

function createResultRow(result, index) {
  const row = document.createElement("tr");
  row.dataset.domain = result.domain;

  const numberCell = document.createElement("td");
  numberCell.textContent = index + 1;

  const domainCell = document.createElement("td");
  domainCell.className = "domain-cell";
  domainCell.textContent = result.domain || "—";

  const drCell = document.createElement("td");

  if (typeof result.domain_rating === "number") {
    const badge = document.createElement("span");
    badge.className = `dr-badge ${getDrClass(result.domain_rating)}`;
    badge.textContent = result.domain_rating;
    drCell.appendChild(badge);
  } else {
    drCell.textContent = "—";
  }

  const statusCell = document.createElement("td");
  const status = document.createElement("span");
  status.className = `status ${getStatusClass(result.status)}`;
  status.textContent = displayStatus(result.status);
  statusCell.appendChild(status);

  row.appendChild(numberCell);
  row.appendChild(domainCell);
  row.appendChild(drCell);
  row.appendChild(statusCell);

  return row;
}

function renderResults() {
  const startIdx = (currentPage - 1) * RESULTS_PER_PAGE;
  const endIdx = startIdx + RESULTS_PER_PAGE;
  const pageResults = filteredResults.slice(startIdx, endIdx);

  // Clear and rebuild only visible rows (incremental update)
  resultsBody.innerHTML = "";

  pageResults.forEach((result, index) => {
    const row = createResultRow(result, startIdx + index + 1);
    resultsBody.appendChild(row);
  });

  renderPagination();
}

function renderPagination() {
  const paginationContainer = document.getElementById("paginationContainer");
  
  if (!paginationContainer) return;

  paginationContainer.innerHTML = "";

  const totalPages = Math.ceil(filteredResults.length / RESULTS_PER_PAGE);

  if (totalPages <= 1) {
    return;
  }

  const navDiv = document.createElement("div");
  navDiv.className = "pagination";

  // Previous button
  if (currentPage > 1) {
    const prevBtn = document.createElement("button");
    prevBtn.className = "pagination-btn";
    prevBtn.textContent = "← Previous";
    prevBtn.addEventListener("click", () => {
      currentPage--;
      renderResults();
      resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    navDiv.appendChild(prevBtn);
  }

  // Page info
  const pageInfo = document.createElement("span");
  pageInfo.className = "page-info";
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  navDiv.appendChild(pageInfo);

  // Next button
  if (currentPage < totalPages) {
    const nextBtn = document.createElement("button");
    nextBtn.className = "pagination-btn";
    nextBtn.textContent = "Next →";
    nextBtn.addEventListener("click", () => {
      currentPage++;
      renderResults();
      resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    navDiv.appendChild(nextBtn);
  }

  paginationContainer.appendChild(navDiv);
}

// ========== MEMOIZED SUMMARY CALCULATION ==========

function updateSummary() {
  if (!allResults.length) {
    cachedSummary = null;
    return;
  }

  // Only recalculate if we have new data
  cachedSummary = {
    total: allResults.length,
    successful: allResults.filter((r) => r.status === "success").length,
    failed: allResults.filter(
      (r) => r.status === "failed" || r.status === "not_found"
    ).length,
  };

  const values = allResults
    .map((r) => r.domain_rating)
    .filter((v) => typeof v === "number");

  cachedSummary.averageDr =
    values.length > 0
      ? values.reduce((sum, val) => sum + val, 0) / values.length
      : null;

  // Update DOM
  totalCount.textContent = cachedSummary.total;
  successCount.textContent = cachedSummary.successful;
  failedCount.textContent = cachedSummary.failed;
  averageDr.textContent =
    cachedSummary.averageDr === null
      ? "—"
      : cachedSummary.averageDr.toFixed(1);
}

// ========== DEBOUNCED SEARCH ==========

function applyFilterAndSort() {
  const query = searchInput.value.trim().toLowerCase();

  // Filter
  filteredResults = allResults.filter((result) =>
    String(result.domain || "").toLowerCase().includes(query)
  );

  // Sort
  filteredResults.sort((a, b) => {
    let valueA = a[sortColumn];
    let valueB = b[sortColumn];

    if (sortColumn === "domain_rating") {
      valueA = typeof valueA === "number" ? valueA : -1;
      valueB = typeof valueB === "number" ? valueB : -1;
    } else {
      valueA = String(valueA ?? "").toLowerCase();
      valueB = String(valueB ?? "").toLowerCase();
    }

    if (valueA < valueB) return sortDirection === "asc" ? -1 : 1;
    if (valueA > valueB) return sortDirection === "asc" ? 1 : -1;

    return 0;
  });

  // Reset to page 1
  currentPage = 1;
  renderResults();
}

function debouncedSearch() {
  clearTimeout(searchDebounceTimer);

  searchDebounceTimer = setTimeout(() => {
    applyFilterAndSort();
  }, SEARCH_DEBOUNCE_MS);
}

// ========== TIMEOUT WRAPPER ==========

function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Request timeout")),
        timeoutMs
      )
    ),
  ]);
}

// ========== API REQUEST ==========

async function checkDomains() {
  hideInputError();
  hideServerError();

  const { domains, invalid } = getDomainsFromInput();

  if (domains.length === 0) {
    showInputError("Please enter at least one valid domain.");
    return;
  }

  if (domains.length > MAX_DOMAINS) {
    showInputError(`You can check a maximum of ${MAX_DOMAINS} domains.`);
    return;
  }

  if (invalid.length > 0) {
    showInputError(`${invalid.length} invalid domain(s) were skipped.`);
  }

  if (API_URL.includes("YOUR-WORKER")) {
    showServerError(
      "Please configure your Cloudflare Worker URL in script.js."
    );
    return;
  }

  setLoading(true);

  try {
    // Send all domains in a single request
    // The worker will handle sequential API calls to Ahrefs (1 domain per request)
    const response = await fetchWithTimeout(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        domains,
      }),
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error("The server returned an invalid response.");
    }

    if (!response.ok) {
      throw new Error(
        data?.error || `Request failed with HTTP ${response.status}.`
      );
    }

    if (!data.success || !Array.isArray(data.results)) {
      throw new Error("The server returned an unexpected response.");
    }

    allResults = data.results;

    // Initial filter/sort
    applyFilterAndSort();
    updateSummary();

    summary.classList.remove("hidden");
    resultsSection.classList.remove("hidden");

    resultsSection.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  } catch (error) {
    console.error(error);

    showServerError(
      error.message || "Unable to check the domains. Please try again."
    );
  } finally {
    setLoading(false);
  }
}

function clearAll() {
  domainInput.value = "";

  allResults = [];
  filteredResults = [];
  cachedSummary = null;
  currentPage = 1;

  summary.classList.add("hidden");
  resultsSection.classList.add("hidden");

  hideInputError();
  hideServerError();

  searchInput.value = "";

  updateCounter();

  resultsBody.innerHTML = "";
  const paginationContainer = document.getElementById("paginationContainer");
  if (paginationContainer) {
    paginationContainer.innerHTML = "";
  }
}

// ========== CSV EXPORT ==========

function escapeCsv(value) {
  const text = String(value ?? "");

  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadCsv() {
  if (!allResults.length) {
    return;
  }

  const rows = [["Domain", "Domain Rating", "Status"]];

  for (const result of allResults) {
    rows.push([
      result.domain,
      result.domain_rating ?? "",
      displayStatus(result.status),
    ]);
  }

  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;

  const date = new Date().toISOString().slice(0, 10);

  link.download = `bulk-dr-results-${date}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

// ========== EVENT LISTENERS ==========

domainInput.addEventListener("input", updateCounter);

checkButton.addEventListener("click", checkDomains);

clearButton.addEventListener("click", clearAll);

downloadButton.addEventListener("click", downloadCsv);

// Debounced search
searchInput.addEventListener("input", debouncedSearch);

// Sortable headers
document.querySelectorAll(".sortable").forEach((header) => {
  header.addEventListener("click", () => {
    const column = header.dataset.sort;

    if (sortColumn === column) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortColumn = column;
      sortDirection = column === "domain_rating" ? "desc" : "asc";
    }

    applyFilterAndSort();
  });
});

// Initialize
updateCounter();
