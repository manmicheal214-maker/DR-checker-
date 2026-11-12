(function () {
  const STORAGE_KEY = "checkdr-analytics-consent";
  const GTM_ID = "GTM-PP972P5P";
  const AHREFS_KEY = "JYJKjwBzSK4mcCZ4VELUEA";
  let bannerKeydownHandler = null;

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

  function updateConsent(analyticsGranted) {
    window.gtag("consent", "update", {
      ad_storage: "denied",
      analytics_storage: analyticsGranted ? "granted" : "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
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
    const choice = options.choice || "";
    const returnFocus = options.returnFocus || null;
    if (!box) {
      box = document.createElement("div");
      box.id = "cookieConsentBanner";
      box.className = "cookie-consent";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "false");
      box.setAttribute("aria-labelledby", "cookieConsentHeading");
      box.setAttribute("aria-describedby", "cookieConsentDescription");
      box.innerHTML = '<h2 id="cookieConsentHeading" class="visually-hidden">Cookie preferences</h2><p id="cookieConsentChoice" class="cookie-consent-choice" aria-live="polite"></p><p id="cookieConsentDescription">CheckDR uses Google Analytics and Ahrefs Web Analytics to understand site usage if you accept. Cloudflare Web Analytics may also measure page performance through a separate Cloudflare dashboard setting. Read our <a href="/privacy.html">Privacy Policy</a> for details.</p><div class="cookie-consent-actions"><button type="button" id="cookieAccept" class="btn btn-secondary">Accept analytics</button><button type="button" id="cookieReject" class="btn btn-secondary">Reject</button><button type="button" id="cookieClose" class="btn btn-secondary">Close</button></div>';
      document.body.appendChild(box);
    }

    box.querySelector("#cookieConsentChoice").textContent =
      choice === "accepted" ? "Current choice: analytics accepted." :
      choice === "rejected" ? "Current choice: analytics rejected." :
      "Current choice: no analytics choice saved.";

    const accept = box.querySelector("#cookieAccept");
    const reject = box.querySelector("#cookieReject");
    const closeButton = box.querySelector("#cookieClose");
    closeButton.hidden = options.fromSettings !== true;

    function close(restoreFocus) {
      if (bannerKeydownHandler) {
        document.removeEventListener("keydown", bannerKeydownHandler);
        bannerKeydownHandler = null;
      }
      box.remove();
      if (restoreFocus && returnFocus && returnFocus.isConnected) returnFocus.focus();
    }

    // Replace any prior handler so reopening the banner never stacks listeners.
    if (bannerKeydownHandler) {
      document.removeEventListener("keydown", bannerKeydownHandler);
      bannerKeydownHandler = null;
    }
    bannerKeydownHandler = function (event) {
      if (event.key === "Escape" && box.contains(document.activeElement)) {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("keydown", bannerKeydownHandler);

    function acceptChoice() {
      try { localStorage.setItem(STORAGE_KEY, "accepted"); } catch (_) {}
      close(true);
      enableAnalytics();
    }

    function rejectChoice() {
      const hadLoadedAnalytics = !!(window.__checkdrGtmLoaded || window.__checkdrAhrefsLoaded);
      try { localStorage.setItem(STORAGE_KEY, "rejected"); } catch (_) {}
      revokeConsent();
      close(true);
      // Already-executing third-party scripts cannot be unloaded reliably; reload the document.
      if (hadLoadedAnalytics) window.location.reload();
    }

    accept.onclick = acceptChoice;
    reject.onclick = rejectChoice;
    closeButton.onclick = function () { close(true); };
    if (options.moveFocus) accept.focus();
  }

  function init() {
    let choice = "";
    try { choice = localStorage.getItem(STORAGE_KEY) || ""; } catch (_) {}

    if (choice === "accepted") {
      enableAnalytics();
    } else {
      updateConsent(false);
      if (!choice || choice === "pending") banner({ choice: choice });
    }

    document.querySelectorAll("#cookieSettingsLink").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        let currentChoice = "";
        try { currentChoice = localStorage.getItem(STORAGE_KEY) || ""; } catch (_) {}
        banner({ moveFocus: true, returnFocus: link, choice: currentChoice, fromSettings: true });
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();