/*

* Bulk DR Checker
*
* IMPORTANT:
* Change API_URL to your Cloudflare Worker URL.
  */

const API_URL = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/check-dr";

const MAX_DOMAINS = 100;

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

let allResults = [];
let sortColumn = "domain_rating";
let sortDirection = "desc";

function normalizeDomain(value) {
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

const pattern =
/^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}.)+[a-zA-Z]{2,63}$/;

return pattern.test(domain);
}

function getDomainsFromInput() {
const lines = domainInput.value
.split(/\r?\n/)
.map(line => line.trim())
.filter(Boolean);

const valid = [];
const invalid = [];

for (const line of lines) {
const domain = normalizeDomain(line);

```
if (!domain || !isValidDomain(domain)) {
  invalid.push(line);
  continue;
}

valid.push(domain);
```

}

const uniqueDomains = [...new Set(valid)];

return {
domains: uniqueDomains,
invalid
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

```
case "not_found":
  return "status-not-found";

default:
  return "status-failed";
```

}
}

function displayStatus(status) {
switch (status) {
case "success":
return "Success";

```
case "not_found":
  return "Not Found";

case "failed":
  return "Failed";

default:
  return status || "Unknown";
```

}
}

function renderResults() {
const query = searchInput.value.trim().toLowerCase();

let filtered = allResults.filter(result =>
String(result.domain || "")
.toLowerCase()
.includes(query)
);

filtered.sort((a, b) => {
let valueA = a[sortColumn];
let valueB = b[sortColumn];

```
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
```

});

resultsBody.innerHTML = "";

filtered.forEach((result, index) => {
const row = document.createElement("tr");

```
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

resultsBody.appendChild(row);
```

});
}

function updateSummary() {
const total = allResults.length;

const successful = allResults.filter(
result => result.status === "success"
).length;

const failed = allResults.filter(
result =>
result.status === "failed" ||
result.status === "not_found"
).length;

const values = allResults
.map(result => result.domain_rating)
.filter(value => typeof value === "number");

const average =
values.length > 0
? values.reduce((sum, value) => sum + value, 0) / values.length
: null;

totalCount.textContent = total;
successCount.textContent = successful;
failedCount.textContent = failed;
averageDr.textContent =
average === null ? "—" : average.toFixed(1);
}

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
showInputError(
`${invalid.length} invalid domain(s) were skipped.`
);
}

if (API_URL.includes("YOUR-WORKER")) {
showServerError(
"Please configure your Cloudflare Worker URL in script.js."
);
return;
}

setLoading(true);

try {
const response = await fetch(API_URL, {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
domains
})
});

```
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

updateSummary();
renderResults();

summary.classList.remove("hidden");
resultsSection.classList.remove("hidden");

resultsSection.scrollIntoView({
  behavior: "smooth",
  block: "start"
});
```

} catch (error) {
console.error(error);

```
showServerError(
  error.message ||
  "Unable to check the domains. Please try again."
);
```

} finally {
setLoading(false);
}
}

function clearAll() {
domainInput.value = "";

allResults = [];

summary.classList.add("hidden");
resultsSection.classList.add("hidden");

hideInputError();
hideServerError();

searchInput.value = "";

updateCounter();

resultsBody.innerHTML = "";
}

function escapeCsv(value) {
const text = String(value ?? "");

if (
text.includes(",") ||
text.includes('"') ||
text.includes("\n")
) {
return `"${text.replace(/"/g, '""')}"`;
}

return text;
}

function downloadCsv() {
if (!allResults.length) {
return;
}

const rows = [
["Domain", "Domain Rating", "Status"]
];

for (const result of allResults) {
rows.push([
result.domain,
result.domain_rating ?? "",
displayStatus(result.status)
]);
}

const csv = rows
.map(row => row.map(escapeCsv).join(","))
.join("\n");

const blob = new Blob([csv], {
type: "text/csv;charset=utf-8;"
});

const url = URL.createObjectURL(blob);

const link = document.createElement("a");
link.href = url;

const date = new Date()
.toISOString()
.slice(0, 10);

link.download = `bulk-dr-results-${date}.csv`;

document.body.appendChild(link);
link.click();
link.remove();

URL.revokeObjectURL(url);
}

domainInput.addEventListener("input", updateCounter);

checkButton.addEventListener("click", checkDomains);

clearButton.addEventListener("click", clearAll);

downloadButton.addEventListener("click", downloadCsv);

searchInput.addEventListener("input", renderResults);

document.querySelectorAll(".sortable").forEach(header => {
header.addEventListener("click", () => {
const column = header.dataset.sort;

```
if (sortColumn === column) {
  sortDirection = sortDirection === "asc" ? "desc" : "asc";
} else {
  sortColumn = column;
  sortDirection = column === "domain_rating" ? "desc" : "asc";
}

renderResults();
```

});
});

updateCounter();
