(function () {
  const STORAGE_KEY = "checkdr-analytics-consent";
  const GTM_ID = "GTM-PP972P5P";
  function loadAnalytics() {
    if (window.__checkdrAnalyticsLoaded) return;
    window.__checkdrAnalyticsLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const gtm = document.createElement("script");
    gtm.async = true;
    gtm.src = "https://www.googletagmanager.com/gtm.js?id=" + GTM_ID;
    document.head.appendChild(gtm);
    const ga = document.createElement("script");
    ga.async = true;
    ga.src = "https://www.googletagmanager.com/gtag/js?id=G-4KD6RD6N91";
    document.head.appendChild(ga);
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", "G-4KD6RD6N91");
    const ahrefs = document.createElement("script");
    ahrefs.async = true;
    ahrefs.src = "https://analytics.ahrefs.com/analytics.js";
    ahrefs.dataset.key = "JYJKjwBzSK4mcCZ4VELUEA";
    document.head.appendChild(ahrefs);
  }
  function banner() {
    if (document.getElementById("cookieConsentBanner")) return;
    const box = document.createElement("aside");
    box.id = "cookieConsentBanner";
    box.className = "cookie-consent";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Cookie preferences");
    box.innerHTML = '<p>CheckDR uses analytics technologies to understand site usage. Accept to load analytics, or continue without analytics.</p><button type="button" id="cookieAccept" class="btn btn-primary">Accept analytics</button><button type="button" id="cookieReject" class="btn btn-secondary">Reject</button>';
    document.body.appendChild(box);
    box.querySelector("#cookieAccept").addEventListener("click", function () {
      try { localStorage.setItem(STORAGE_KEY, "accepted"); } catch (_) {}
      box.remove(); loadAnalytics();
    });
    box.querySelector("#cookieReject").addEventListener("click", function () {
      try { localStorage.setItem(STORAGE_KEY, "rejected"); } catch (_) {}
      box.remove();
    });
  }
  function init() {
    let choice = "";
    try { choice = localStorage.getItem(STORAGE_KEY) || ""; } catch (_) {}
    if (choice === "accepted") loadAnalytics();
    else if (!choice) banner();
    document.querySelectorAll("#cookieSettingsLink").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        banner();
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();