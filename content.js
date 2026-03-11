(function () {
  const hostname = (window.location.hostname || "").toLowerCase();

  if (!hostname.includes("glassbob")) {
    return;
  }

  let lastScannedUrl = null;

  function isLikelyPropertyUrl(url) {
    const lowerUrl = (url || "").toLowerCase();
    return (
      lowerUrl.includes("/property/") ||
      lowerUrl.includes("/listing/") ||
      lowerUrl.includes("/details/") ||
      lowerUrl.includes("/advert/")
    );
  }

  function extractPropertyFromPage() {
    const text = (document.body.innerText || "").trim();

    const lines = text
      .split("\n")
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line.length > 0; });

    const title =
      lines.find(function (line) {
        return /(?:Road|Close|Gardens|Street|Lane|Drive|Avenue)$/i.test(line) &&
               line.toLowerCase() !== "close";
      }) || "";

    const location =
      lines.find(function (line) {
        return /[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}/i.test(line);
      }) || "";

    const bedrooms =
      lines.find(function (line) {
        return /\b\d+\s*Bed\b/i.test(line);
      }) || "";

    const wantedLocations = lines
      .filter(function (line) {
        return line.includes("Within ") && line.includes(" miles of ");
      })
      .map(function (line) {
        const match = line.match(/miles of ([^(,]+)/i);
        return match ? match[1].trim() : null;
      })
      .filter(Boolean);

    const hasPropertySignals = !!title || !!location || !!bedrooms || wantedLocations.length > 0;
    const looksLikePropertyPage = hasPropertySignals && isLikelyPropertyUrl(window.location.href);

    return {
      sourceSite: "glassbob",
      title: title,
      location: location,
      bedrooms: bedrooms,
      wantedLocations: wantedLocations,
      url: window.location.href,
      scannedAt: new Date().toISOString(),
      active: true,
      looksLikePropertyPage: looksLikePropertyPage
    };
  }

  function saveIfPassiveEnabled() {
    chrome.storage.local.get(["passiveScanEnabled", "savedProperties"], function (data) {
      if (!data.passiveScanEnabled) return;

      const found = extractPropertyFromPage();

      if (!found.looksLikePropertyPage) return;
      if (lastScannedUrl === found.url) return;

      const saved = data.savedProperties || [];
      const existingIndex = saved.findIndex(function (item) {
        return item.url === found.url;
      });

      delete found.looksLikePropertyPage;

      if (existingIndex === -1) {
        saved.push(found);
      } else {
        saved[existingIndex] = Object.assign({}, saved[existingIndex], found);
      }

      chrome.storage.local.set(
        {
          savedProperties: saved,
          lastPassiveScan: {
            url: found.url,
            title: found.title || "(no title found)",
            scannedAt: found.scannedAt
          }
        },
        function () {
          lastScannedUrl = found.url;
          console.log("[SwapPathFinder] Passive scan saved:", found.url);
        }
      );
    });
  }

  function runPassiveScanWithRetries() {
    let attempts = 0;
    const maxAttempts = 6;

    function tryScan() {
      attempts += 1;
      saveIfPassiveEnabled();
      if (attempts < maxAttempts) {
        setTimeout(tryScan, 1500);
      }
    }

    tryScan();
  }

  let previousUrl = window.location.href;

  function watchForUrlChanges() {
    setInterval(function () {
      if (window.location.href !== previousUrl) {
        previousUrl = window.location.href;
        lastScannedUrl = null;
        runPassiveScanWithRetries();
      }
    }, 1000);
  }

  runPassiveScanWithRetries();
  watchForUrlChanges();
})();
