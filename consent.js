(function () {
  const STORAGE_KEY = "checkdr-analytics-consent";
  // Set this to the real container ID when supplied, e.g. "GTM-ABC1234".
  // Keep empty until then: no Google scripts are requested without a real ID.
  const GTM_ID = "";

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  // Consent Mode v2 defaults are queued before GTM is ever requested.
  window.gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500
  });

  function updateConsent(granted) {
    const value = granted ? "granted" : "denied";
    window.gtag("consent", "update", {
      ad_storage: value,
      analytics_storage: value,
      ad_user_data: value,
      ad_personalization: value
    });
  }

  function clearAnalyticsCookies() {
    document.cookie.split(";").forEach(function (item) {
      const name = item.trim().split("=")[0];
      if (name && /^(?:_ga(?:_.+)?|_gid|_gat(?:_.+)?|_gcl_.+|IDE|ahrefs.*)$/i.test(name)) {
        document.cookie = name + "=; Max-Age=0; path=/; SameSite=Lax";
        document.cookie = name + "=; Max-Age=0; path=/; domain=" + location.hostname + "; SameSite=Lax";
      }
    });
  }

  function loadGoogleTagManager() {
    if (!/^GTM-[A-Z0-9]+$/.test(GTM_ID) || window.__checkdrGtmLoaded) return;
    window.__checkdrGtmLoaded = true;
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(GTM_ID);
    document.head.appendChild(script);
  }

  function revokeConsent() {
    updateConsent(false);
    clearAnalyticsCookies();
  }

  function banner() {
    if (document.getElementById("cookieConsentBanner")) return;
    const box = document.createElement("aside");
    box.id = "cookieConsentBanner";
    box.className = "cookie-consent";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Cookie preferences");
    box.innerHTML = '<p>CheckDR uses analytics technologies to understand site usage. Accept to enable analytics, or reject to continue without analytics.</p><button type="button" id="cookieAccept" class="btn btn-primary">Accept analytics</button><button type="button" id="cookieReject" class="btn btn-secondary">Reject</button>';
    document.body.appendChild(box);

    box.querySelector("#cookieAccept").addEventListener("click", function () {
      try { localStorage.setItem(STORAGE_KEY, "accepted"); } catch (_) {}
      box.remove();
      if (/^GTM-[A-Z0-9]+$/.test(GTM_ID)) {
        updateConsent(true);
        loadGoogleTagManager();
      } else {
        updateConsent(false);
      }
    });

    box.querySelector("#cookieReject").addEventListener("click", function () {
      try { localStorage.setItem(STORAGE_KEY, "rejected"); } catch (_) {}
      revokeConsent();
      box.remove();
    });
  }

  function init() {
    let choice = "";
    try { choice = localStorage.getItem(STORAGE_KEY) || ""; } catch (_) {}

    if (choice === "accepted" && /^GTM-[A-Z0-9]+$/.test(GTM_ID)) {
      updateConsent(true);
      loadGoogleTagManager();
    } else {
      updateConsent(false);
      if (!choice) banner();
    }

    document.querySelectorAll("#cookieSettingsLink").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        revokeConsent();
        banner();
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();