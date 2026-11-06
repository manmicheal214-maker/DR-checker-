(function () {
  const STORAGE_KEY = "checkdr-analytics-consent";
  const GTM_ID = "GTM-PP972P5P";
  const AHREFS_KEY = "JYJKjwBzSK4mcCZ4VELUEA";

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  // Queue Consent Mode v2 defaults before requesting any analytics script.
  window.gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500
  });

  function hasValidGtmId() {
    return /^GTM-[A-Z0-9]+$/.test(GTM_ID) && GTM_ID !== "GTM-XXXXXXX";
  }

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
      if (name && /^(?:_ga(?:_.+)?|_gid|_gat(?:_.+)?|_gcl_.+|IDE)$/i.test(name)) {
        document.cookie = name + "=; Max-Age=0; path=/; SameSite=Lax";
        document.cookie = name + "=; Max-Age=0; path=/; domain=" + location.hostname + "; SameSite=Lax";
      }
    });
  }

  function loadGoogleTagManager() {
    if (!hasValidGtmId() || window.__checkdrGtmLoaded) return;
    window.__checkdrGtmLoaded = true;
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(GTM_ID);
    document.head.appendChild(script);
  }

  function loadAhrefsAnalytics() {
    if (window.__checkdrAhrefsLoaded) return;
    window.__checkdrAhrefsLoaded = true;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://analytics.ahrefs.com/analytics.js";
    script.dataset.key = AHREFS_KEY;
    document.head.appendChild(script);
  }

  function enableAnalytics() {
    if (!hasValidGtmId()) {
      updateConsent(false);
      return;
    }
    updateConsent(true);
    loadGoogleTagManager();
    loadAhrefsAnalytics();
  }

  function revokeConsent() {
    updateConsent(false);
    clearAnalyticsCookies();
  }

  function banner(options) {
    options = options || {};
    let box = document.getElementById("cookieConsentBanner");
    if (!box) {
      box = document.createElement("div");
      box.id = "cookieConsentBanner";
      box.className = "cookie-consent";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "false");
      box.setAttribute("aria-labelledby", "cookieConsentHeading");
      box.setAttribute("aria-describedby", "cookieConsentDescription");
      box.innerHTML = '<h2 id="cookieConsentHeading" class="visually-hidden">Cookie preferences</h2><p id="cookieConsentDescription">CheckDR uses analytics technologies to understand site usage. Accept to enable analytics, or reject to continue without analytics.</p><button type="button" id="cookieAccept" class="btn btn-secondary">Accept analytics</button><button type="button" id="cookieReject" class="btn btn-secondary">Reject</button>';
      document.body.appendChild(box);
    }

    const returnFocus = options.returnFocus || null;
    function close() {
      box.remove();
      if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    }

    box.querySelector("#cookieAccept").onclick = function () {
      try { localStorage.setItem(STORAGE_KEY, "accepted"); } catch (_) {}
      close();
      enableAnalytics();
    };

    box.querySelector("#cookieReject").onclick = function () {
      try { localStorage.setItem(STORAGE_KEY, "rejected"); } catch (_) {}
      revokeConsent();
      close();
    };

    // Only an explicit settings-link activation moves focus; first-load display stays non-intrusive.
    if (options.moveFocus) box.querySelector("#cookieAccept").focus();
  }

  function init() {
    let choice = "";
    try { choice = localStorage.getItem(STORAGE_KEY) || ""; } catch (_) {}

    if (choice === "accepted") {
      enableAnalytics();
    } else {
      updateConsent(false);
      if (!choice || choice === "pending") banner();
    }

    document.querySelectorAll("#cookieSettingsLink").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        try { localStorage.setItem(STORAGE_KEY, "pending"); } catch (_) {}
        revokeConsent();
        banner({ moveFocus: true, returnFocus: link });
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();