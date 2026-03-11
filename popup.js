// ─────────────────────────────────────────────
// SCRAPING - runs in page context via scripting
// ─────────────────────────────────────────────

function extractPropertyFromPage() {
  // NOTE: this function is serialised and injected into the page tab.
  // It cannot reference anything outside itself.

  function isLikelyPropertyUrl(url) {
    const u = (url || "").toLowerCase();
    return (
      u.includes("/property/") ||
      u.includes("/listing/") ||
      u.includes("/details/") ||
      u.includes("/advert/")
    );
  }

  const text = (document.body.innerText || "").trim();
  const lines = text
    .split("\n")
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l.length > 0; });

  const title =
    lines.find(function (l) {
      return /(?:Road|Close|Gardens|Street|Lane|Drive|Avenue)$/i.test(l) &&
             l.toLowerCase() !== "close";
    }) || "";

  const location =
    lines.find(function (l) {
      return /[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}/i.test(l);
    }) || "";

  const bedrooms =
    lines.find(function (l) {
      return /\b\d+\s*Bed\b/i.test(l);
    }) || "";

  const wantedLocations = lines
    .filter(function (l) {
      return l.includes("Within ") && l.includes(" miles of ");
    })
    .map(function (l) {
      const m = l.match(/miles of ([^(,]+)/i);
      return m ? m[1].trim() : null;
    })
    .filter(Boolean);

  const hasSignals = !!title || !!location || !!bedrooms || wantedLocations.length > 0;
  const looksLikePropertyPage = hasSignals && isLikelyPropertyUrl(window.location.href);

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

function extractResultsLinksFromPage() {
  function cleanUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return url.origin + url.pathname;
    } catch (e) {
      return rawUrl;
    }
  }

  function parseCardText(rawText) {
    const junkLines = {
      "favorite_border": true,
      "favorite": true,
      "contact tenant": true,
      "fiber_new": true,
      "delete_forever": true
    };

    const lines = (rawText || "")
      .split("\n")
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; })
      .filter(function (l) { return !junkLines[l.toLowerCase()]; });

    const locationLine = lines.find(function (l) {
      return /[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}/i.test(l);
    }) || "";

    const fullPostcodeMatch = locationLine.match(/[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}/i);
    const fullPostcode = fullPostcodeMatch ? fullPostcodeMatch[0].toUpperCase() : "";
    const postcodeArea = fullPostcode ? fullPostcode.split(" ")[0] : "";

    let area = "";
    if (locationLine && fullPostcode) {
      area = locationLine.replace(fullPostcode, "").replace(/\s+/g, " ").trim();
    }

    const bedroomTypeLine = lines.find(function (l) {
      return /\b\d+\s*Bed\b/i.test(l);
    }) || "";

    const bedroomsMatch = bedroomTypeLine.match(/\b\d+\s*Bed\b/i);
    const bedrooms = bedroomsMatch ? bedroomsMatch[0] : "";

    let propertyType = "";
    const typeMatch = bedroomTypeLine.match(/\b(Flat|House|Maisonette|Bungalow|Studio)\b/i);
    if (typeMatch) propertyType = typeMatch[0];

    let label = "";
    if (bedrooms && propertyType) {
      label = bedrooms.toLowerCase() + " - " + propertyType.toLowerCase();
    } else if (bedroomTypeLine) {
      label = bedroomTypeLine;
    } else {
      label = "Property";
    }

    return { area, postcodeArea, bedrooms, propertyType, label };
  }

  const anchors = Array.from(document.querySelectorAll("a[href]"));

  const candidates = anchors
    .map(function (a) {
      const rawUrl = a.href;
      const cleanedUrl = cleanUrl(rawUrl);
      const parsed = parseCardText(a.innerText || a.textContent || "");
      return Object.assign({ rawUrl, url: cleanedUrl }, parsed);
    })
    .filter(function (item) {
      if (!item.url || !item.url.startsWith("http")) return false;
      const url = item.url.toLowerCase();
      return (
        url.includes("/property/") ||
        url.includes("/listing/") ||
        url.includes("/details/") ||
        url.includes("/advert/")
      );
    });

  const uniqueByUrl = [];
  const seen = {};

  candidates.forEach(function (item) {
    if (!seen[item.url]) {
      seen[item.url] = true;
      uniqueByUrl.push({
        url: item.url,
        area: item.area || "Unknown area",
        postcodeArea: item.postcodeArea || "",
        bedrooms: item.bedrooms || "",
        propertyType: item.propertyType || "",
        label: item.label || "Property",
        collectedAt: new Date().toISOString(),
        scanned: false
      });
    }
  });

  return uniqueByUrl;
}

// ─────────────────────────────────────────────
// DATA HELPERS
// ─────────────────────────────────────────────

function deriveAreaFromLocation(location) {
  const text = String(location || "").trim();
  if (!text) return "Unknown area";
  const postcodeMatch = text.match(/[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}/i);
  const postcode = postcodeMatch ? postcodeMatch[0] : "";
  let area = text;
  if (postcode) area = text.replace(postcode, "").replace(/\s+/g, " ").trim();
  return area || "Unknown area";
}

function derivePostcodeArea(location) {
  const text = String(location || "").trim();
  if (!text) return "";
  const postcodeMatch = text.match(/[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}/i);
  if (!postcodeMatch) return "";
  return postcodeMatch[0].toUpperCase().split(" ")[0];
}

function derivePropertyType(title, bedrooms) {
  const combined = ((title || "") + " " + (bedrooms || "")).toLowerCase();
  if (combined.includes("flat")) return "Flat";
  if (combined.includes("house")) return "House";
  if (combined.includes("maisonette")) return "Maisonette";
  if (combined.includes("bungalow")) return "Bungalow";
  if (combined.includes("studio")) return "Studio";
  return "";
}

function makeCoarsePropertyLabel(property) {
  const parts = [];
  const bedrooms = property.bedrooms || "";
  const propertyType = property.propertyType || derivePropertyType(property.title, property.bedrooms);
  const postcodeArea = property.currentPostcodeArea || derivePostcodeArea(property.location);
  if (bedrooms) parts.push(bedrooms.toLowerCase());
  if (propertyType) {
    const lowerType = propertyType.toLowerCase();
    if (!bedrooms.toLowerCase().includes(lowerType)) parts.push(lowerType);
  }
  if (postcodeArea) parts.push(postcodeArea);
  return parts.length ? parts.join(" - ") : "Property";
}

function upsertSavedProperty(saved, found) {
  const enriched = Object.assign({}, found, {
    currentArea: deriveAreaFromLocation(found.location),
    currentPostcodeArea: derivePostcodeArea(found.location),
    propertyType: derivePropertyType(found.title, found.bedrooms)
  });

  const existingIndex = saved.findIndex(function (item) {
    return item.url === enriched.url;
  });

  if (existingIndex === -1) {
    saved.push(enriched);
  } else {
    saved[existingIndex] = Object.assign({}, saved[existingIndex], enriched);
  }

  return { saved, property: enriched };
}

function markQueueItemScanned(queue, url) {
  return queue.map(function (item) {
    if (item.url === url) return Object.assign({}, item, { scanned: true });
    return item;
  });
}

// ─────────────────────────────────────────────
// SWAP CHAIN FINDER
// ─────────────────────────────────────────────

function findSwapChains(savedProperties, maxDepth) {
  maxDepth = maxDepth || 4;

  const byArea = {};

  savedProperties.forEach(function (prop) {
    const area = (prop.currentArea || "").toLowerCase().trim();
    if (!area || area === "unknown area") return;
    if (!byArea[area]) byArea[area] = [];
    byArea[area].push(prop);
  });

  const chains = [];
  const chainSignatures = {};

  function search(chain, visitedAreas) {
    const current = chain[chain.length - 1];
    const wanted = Array.isArray(current.wantedLocations) ? current.wantedLocations : [];

    wanted.forEach(function (wantedTown) {
      const key = wantedTown.toLowerCase().trim();
      const originArea = chain[0].currentArea.toLowerCase().trim();

      if (key === originArea && chain.length > 1) {
        const signature = chain.map(function (p) { return p.url; }).sort().join("|");
        if (!chainSignatures[signature]) {
          chainSignatures[signature] = true;
          chains.push(chain.slice());
        }
        return;
      }

      if (visitedAreas[key]) return;
      if (chain.length >= maxDepth) return;

      const candidates = byArea[key] || [];

      candidates.forEach(function (candidate) {
        visitedAreas[key] = true;
        chain.push(candidate);
        search(chain, visitedAreas);
        chain.pop();
        delete visitedAreas[key];
      });
    });
  }

  savedProperties.forEach(function (startProp) {
    const startArea = (startProp.currentArea || "").toLowerCase().trim();
    if (!startArea || startArea === "unknown area") return;
    const visited = {};
    visited[startArea] = true;
    search([startProp], visited);
  });

  chains.sort(function (a, b) {
    if (a.length !== b.length) return a.length - b.length;
    return a[0].currentArea.localeCompare(b[0].currentArea);
  });

  return chains;
}

// ─────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatusText(text) {
  document.getElementById("status").textContent = text;
}

function setStatusHtml(html) {
  document.getElementById("status").innerHTML = html;
}

function attachToggleListeners(className) {
  document.querySelectorAll("." + className).forEach(function (button) {
    button.addEventListener("click", function () {
      const targetId = button.getAttribute("data-target");
      const detail = document.getElementById(targetId);
      if (!detail) return;
      detail.style.display = detail.style.display === "none" ? "block" : "none";
    });
  });
}

// ─────────────────────────────────────────────
// RENDER FUNCTIONS
// ─────────────────────────────────────────────

function refreshPopupState() {
  const toggleButton = document.getElementById("togglePassive");

  chrome.storage.local.get(
    ["passiveScanEnabled", "savedProperties", "lastPassiveScan", "resultsQueue"],
    function (data) {
      const enabled = !!data.passiveScanEnabled;
      const saved = data.savedProperties || [];
      const queue = data.resultsQueue || [];
      const lastScan = data.lastPassiveScan || null;
      const unscannedCount = queue.filter(function (item) { return !item.scanned; }).length;

      toggleButton.textContent = enabled ? "Passive Scan: ON" : "Passive Scan: OFF";
      toggleButton.className = enabled ? "active" : "";

      const lines = [
        "Passive scan: " + (enabled ? "ON" : "OFF"),
        "Saved properties: " + saved.length,
        "Queued links: " + queue.length,
        "Unscanned: " + unscannedCount
      ];

      if (lastScan) {
        lines.push("Last scanned: " + lastScan.url);
      }

      setStatusText(lines.join("\n"));
    }
  );
}

function renderQueueGrouped(queue) {
  if (!queue.length) {
    setStatusText("No queued links yet.");
    return;
  }

  const grouped = {};

  queue.forEach(function (item, index) {
    const area = item.area || "Unknown area";
    const postcodeArea = item.postcodeArea || "Unknown postcode area";
    if (!grouped[area]) grouped[area] = {};
    if (!grouped[area][postcodeArea]) grouped[area][postcodeArea] = [];
    grouped[area][postcodeArea].push(Object.assign({}, item, { _id: "queue-item-" + index }));
  });

  let html = "<div><strong>Queued links (" + queue.length + ")</strong></div>";

  Object.keys(grouped).sort().forEach(function (area) {
    html += "<div style='margin-top:10px;'><strong>" + escapeHtml(area) + "</strong></div>";

    Object.keys(grouped[area]).sort().forEach(function (postcodeArea) {
      html += "<div style='margin-top:6px; margin-left:10px;'><strong>" + escapeHtml(postcodeArea) + "</strong></div>";

      grouped[area][postcodeArea].forEach(function (item) {
        html +=
          "<div style='margin-left:20px; margin-top:6px;'>" +
            "<button class='queue-toggle' data-target='" + escapeHtml(item._id) + "' style='width:100%; text-align:left; padding:4px; cursor:pointer;'>" +
              escapeHtml(item.label + (item.scanned ? " ✓" : "")) +
            "</button>" +
            "<div id='" + escapeHtml(item._id) + "' style='display:none; margin-top:4px; margin-left:8px; padding:6px; border-left:2px solid #ccc; font-size:11px;'>" +
              "<div>Area: " + escapeHtml(item.area || "Unknown") + "</div>" +
              "<div>Postcode: " + escapeHtml(item.postcodeArea || "Unknown") + "</div>" +
              "<div>Bedrooms: " + escapeHtml(item.bedrooms || "Unknown") + "</div>" +
              "<div>Type: " + escapeHtml(item.propertyType || "Unknown") + "</div>" +
              "<div>Scanned: " + (item.scanned ? "Yes" : "No") + "</div>" +
              "<div style='margin-top:4px;'><a href='" + escapeHtml(item.url) + "' target='_blank'>Open listing</a></div>" +
            "</div>" +
          "</div>";
      });
    });
  });

  setStatusHtml(html);
  attachToggleListeners("queue-toggle");
}

function renderOutboundRoutes(savedProperties) {
  if (!savedProperties.length) {
    setStatusText("No saved properties yet.");
    return;
  }

  const routes = {};

  savedProperties.forEach(function (property, index) {
    const currentArea = property.currentArea || deriveAreaFromLocation(property.location);
    const currentPostcodeArea = property.currentPostcodeArea || derivePostcodeArea(property.location);
    const supportingLabel = makeCoarsePropertyLabel(property);
    const wantedLocations = Array.isArray(property.wantedLocations) ? property.wantedLocations : [];

    if (!routes[currentArea]) routes[currentArea] = {};

    wantedLocations.forEach(function (wantedTown) {
      const clean = String(wantedTown || "").trim();
      if (!clean) return;
      if (!routes[currentArea][clean]) routes[currentArea][clean] = [];
      routes[currentArea][clean].push({
        _id: "route-item-" + index + "-" + clean.replace(/\s+/g, "-"),
        url: property.url,
        label: supportingLabel,
        currentPostcodeArea: currentPostcodeArea,
        bedrooms: property.bedrooms || "",
        propertyType: property.propertyType || derivePropertyType(property.title, property.bedrooms),
        scannedAt: property.scannedAt || ""
      });
    });
  });

  const currentAreas = Object.keys(routes).sort();

  if (!currentAreas.length) {
    setStatusText("No outbound route signals found yet.");
    return;
  }

  let html = "<div><strong>Outbound routes</strong></div>";

  currentAreas.forEach(function (currentArea) {
    html += "<div style='margin-top:10px;'><strong>" + escapeHtml(currentArea) + "</strong></div>";

    const wantedTowns = Object.keys(routes[currentArea]).sort(function (a, b) {
      return routes[currentArea][b].length - routes[currentArea][a].length;
    });

    wantedTowns.forEach(function (wantedTown) {
      const items = routes[currentArea][wantedTown];
      const routeId = "route-group-" + currentArea.replace(/\s+/g, "-") + "-" + wantedTown.replace(/\s+/g, "-");

      html +=
        "<div style='margin-top:6px; margin-left:10px;'>" +
          "<button class='route-toggle' data-target='" + escapeHtml(routeId) + "' style='width:100%; text-align:left; padding:4px; cursor:pointer;'>" +
            escapeHtml(wantedTown + " (" + items.length + ")") +
          "</button>" +
          "<div id='" + escapeHtml(routeId) + "' style='display:none; margin-top:4px; margin-left:8px; padding:6px; border-left:2px solid #ccc; font-size:11px;'>" +
            items.map(function (item) {
              return (
                "<div style='margin-top:6px;'>" +
                  "<strong>" + escapeHtml(item.label) + "</strong><br>" +
                  "Postcode: " + escapeHtml(item.currentPostcodeArea || "Unknown") + "<br>" +
                  "Bedrooms: " + escapeHtml(item.bedrooms || "Unknown") + "<br>" +
                  "<a href='" + escapeHtml(item.url) + "' target='_blank'>Open listing</a>" +
                "</div>"
              );
            }).join("") +
          "</div>" +
        "</div>";
    });
  });

  setStatusHtml(html);
  attachToggleListeners("route-toggle");
}

function renderSwapChains(chains, savedCount) {
  if (!chains.length) {
    setStatusHtml(
      "<div><strong>No complete swap chains found yet.</strong></div>" +
      "<div style='margin-top:8px; font-size:11px; color:#555;'>" +
        "You have " + savedCount + " saved " + (savedCount === 1 ? "property" : "properties") + ". " +
        "Keep scanning — chains appear once properties in different areas want each other's locations." +
      "</div>"
    );
    return;
  }

  let html = "<div><strong>🔁 Swap chains found: " + chains.length + "</strong></div>";

  chains.forEach(function (chain, i) {
    const chainId = "chain-" + i;
    const routeText = chain.map(function (p) {
      return p.currentArea || "Unknown";
    }).join(" → ") + " → 🔁";

    html +=
      "<div style='margin-top:10px; border-left:3px solid #28a745; padding-left:8px;'>" +
        "<button class='chain-toggle' data-target='" + chainId + "' style='width:100%; text-align:left; padding:4px; cursor:pointer; background:#d4edda; border:none; font-weight:bold;'>" +
          chain.length + "-way swap: " + escapeHtml(chain[0].currentArea || "?") + " →…" +
        "</button>" +
        "<div id='" + chainId + "' style='display:none; margin-top:6px;'>" +
          "<div style='font-size:11px; color:#555; margin-bottom:6px;'>" + escapeHtml(routeText) + "</div>" +
          chain.map(function (prop, j) {
            const arrow = j < chain.length - 1
              ? " → " + escapeHtml((chain[j + 1].currentArea || "?"))
              : " → 🔁 back to " + escapeHtml((chain[0].currentArea || "?"));
            return (
              "<div style='margin-top:6px; padding:6px; background:#f8f9fa; border-radius:4px; font-size:11px;'>" +
                "<strong>" + escapeHtml(prop.currentArea || "Unknown") + "</strong>" + escapeHtml(arrow) + "<br>" +
                (prop.bedrooms ? "Bedrooms: " + escapeHtml(prop.bedrooms) + "<br>" : "") +
                (prop.propertyType ? "Type: " + escapeHtml(prop.propertyType) + "<br>" : "") +
                "<a href='" + escapeHtml(prop.url) + "' target='_blank'>Open listing</a>" +
              "</div>"
            );
          }).join("") +
        "</div>" +
      "</div>";
  });

  setStatusHtml(html);
  attachToggleListeners("chain-toggle");
}

// ─────────────────────────────────────────────
// TAB / SCRIPTING HELPERS
// ─────────────────────────────────────────────

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let done = false;

    function finish(ok, msg) {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeoutId);
      ok ? resolve() : reject(new Error(msg));
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(true);
    }

    const timeoutId = setTimeout(function () {
      finish(false, "Timed out waiting for tab to load.");
    }, timeoutMs || 15000);

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError) { finish(false, chrome.runtime.lastError.message); return; }
      if (tab && tab.status === "complete") finish(true);
    });
  });
}

function executeScriptPromise(tabId, func) {
  return new Promise(function (resolve, reject) {
    chrome.scripting.executeScript({ target: { tabId }, func }, function (results) {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      resolve(results && results[0] ? results[0].result : null);
    });
  });
}

function createTabPromise(url, active) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.create({ url, active: !!active }, function (tab) {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      resolve(tab);
    });
  });
}

function removeTabPromise(tabId) {
  return new Promise(function (resolve) {
    chrome.tabs.remove(tabId, resolve);
  });
}

// ─────────────────────────────────────────────
// SCAN QUEUE
// ─────────────────────────────────────────────

function savePropertyRecord(found) {
  chrome.storage.local.get(["savedProperties", "resultsQueue"], function (data) {
    const saved = data.savedProperties || [];
    const queue = data.resultsQueue || [];

    const result = upsertSavedProperty(saved, found);
    const updatedQueue = markQueueItemScanned(queue, result.property.url);

    chrome.storage.local.set(
      {
        savedProperties: result.saved,
        resultsQueue: updatedQueue,
        lastPassiveScan: {
          url: result.property.url,
          title: result.property.title || "(no title found)",
          scannedAt: result.property.scannedAt
        }
      },
      function () {
        setStatusText(
          "Saved property.\nTotal saved: " + result.saved.length + "\n\n" +
          JSON.stringify(result.property, null, 2)
        );
        refreshPopupState();
      }
    );
  });
}

async function scanNextQueuedLink() {
  chrome.storage.local.get(["resultsQueue", "savedProperties"], async function (data) {
    const queue = data.resultsQueue || [];
    const saved = data.savedProperties || [];

    const nextItem = queue.find(function (item) { return !item.scanned; });

    if (!nextItem) {
      setStatusText("No unscanned queued links found.");
      return;
    }

    setStatusText("Opening queued link...\n\n" + nextItem.url);

    let tempTab = null;

    try {
      tempTab = await createTabPromise(nextItem.url, false);
     await waitForTabComplete(tempTab.id, 20000);

// Wait for JS-rendered content to populate
await new Promise(function (resolve) { setTimeout(resolve, 1500); });

setStatusText("Scanning...\n\n" + nextItem.url);

const found = await executeScriptPromise(tempTab.id, extractPropertyFromPage);

      if (!found || !found.looksLikePropertyPage) {
        throw new Error("Page did not look like a supported property page.");
      }

      delete found.looksLikePropertyPage;

      const result = upsertSavedProperty(saved, found);
      const updatedQueue = markQueueItemScanned(queue, result.property.url);

      chrome.storage.local.set(
        {
          savedProperties: result.saved,
          resultsQueue: updatedQueue,
          lastPassiveScan: {
            url: result.property.url,
            title: result.property.title || "(no title found)",
            scannedAt: result.property.scannedAt
          }
        },
        async function () {
          await removeTabPromise(tempTab.id);
          setStatusText(
            "Scanned successfully.\nSaved: " + result.saved.length +
            "\nRemaining: " + updatedQueue.filter(function (i) { return !i.scanned; }).length
          );
          refreshPopupState();
        }
      );
    } catch (error) {
      if (tempTab) await removeTabPromise(tempTab.id);
      setStatusText("Scan failed.\n\n" + error.message);
    }
  });
}
// ─────────────────────────────────────────────
// AUTO SCAN ALL QUEUE
// ─────────────────────────────────────────────

let autoScanStopped = false;

async function scanAllQueue() {
  autoScanStopped = false;

  document.getElementById("scanAllQueue").style.display = "none";
  document.getElementById("stopScan").style.display = "block";

  let scannedThisRun = 0;
  let failedThisRun = 0;

  while (true) {
    if (autoScanStopped) {
      setStatusText(
        "Scan stopped.\n" +
        "Scanned this run: " + scannedThisRun + "\n" +
        "Failed this run: " + failedThisRun
      );
      break;
    }

    // Re-read queue each loop so we always have fresh state
    const data = await new Promise(function (resolve) {
      chrome.storage.local.get(["resultsQueue", "savedProperties"], resolve);
    });

    const queue = data.resultsQueue || [];
    const saved = data.savedProperties || [];
    const nextItem = queue.find(function (item) { return !item.scanned; });

    if (!nextItem) {
      setStatusText(
        "✅ Queue complete!\n" +
        "Scanned this run: " + scannedThisRun + "\n" +
        "Failed this run: " + failedThisRun + "\n" +
        "Total saved: " + saved.length
      );
      break;
    }

    const remaining = queue.filter(function (i) { return !i.scanned; }).length;
    setStatusText(
      "Scanning...\n" +
      "Remaining: " + remaining + "\n" +
      "Scanned this run: " + scannedThisRun + "\n" +
      "Failed this run: " + failedThisRun + "\n\n" +
      nextItem.url
    );

    let tempTab = null;

    try {
      tempTab = await createTabPromise(nextItem.url, false);
      await waitForTabComplete(tempTab.id, 20000);
      await new Promise(function (resolve) { setTimeout(resolve, 3000); });

      if (autoScanStopped) {
        await removeTabPromise(tempTab.id);
        break;
      }

      const found = await executeScriptPromise(tempTab.id, extractPropertyFromPage);
      await removeTabPromise(tempTab.id);
      tempTab = null;

      if (!found || !found.looksLikePropertyPage) {
        // Mark as scanned anyway so we don't retry it forever
        const updatedQueue = markQueueItemScanned(queue, nextItem.url);
        await new Promise(function (resolve) {
          chrome.storage.local.set({ resultsQueue: updatedQueue }, resolve);
        });
        failedThisRun++;
      } else {
        delete found.looksLikePropertyPage;
        const result = upsertSavedProperty(saved, found);
        const updatedQueue = markQueueItemScanned(queue, result.property.url);

        await new Promise(function (resolve) {
          chrome.storage.local.set({
            savedProperties: result.saved,
            resultsQueue: updatedQueue,
            lastPassiveScan: {
              url: result.property.url,
              title: result.property.title || "(no title found)",
              scannedAt: result.property.scannedAt
            }
          }, resolve);
        });
        scannedThisRun++;
      }

    } catch (error) {
      if (tempTab) {
        try { await removeTabPromise(tempTab.id); } catch (e) {}
      }
      // Mark as scanned so we don't get stuck on a broken link
      const updatedQueue = markQueueItemScanned(queue, nextItem.url);
      await new Promise(function (resolve) {
        chrome.storage.local.set({ resultsQueue: updatedQueue }, resolve);
      });
      failedThisRun++;
    }

    // Small pause between tabs to be polite to the server
    await new Promise(function (resolve) { setTimeout(resolve, 500); });
  }

  document.getElementById("scanAllQueue").style.display = "block";
  document.getElementById("stopScan").style.display = "none";
}
// ─────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  const togglePassiveButton = document.getElementById("togglePassive");
  const scanButton = document.getElementById("scan");
  const collectLinksButton = document.getElementById("collectLinks");
  const scanNextQueueButton = document.getElementById("scanNextQueue");
  const viewQueueButton = document.getElementById("viewQueue");
  const viewRoutesButton = document.getElementById("viewRoutes");
  const viewButton = document.getElementById("view");
  const findChainsButton = document.getElementById("findChains");
  const clearButton = document.getElementById("clear");

  togglePassiveButton.addEventListener("click", function () {
    chrome.storage.local.get(["passiveScanEnabled"], function (data) {
      const next = !data.passiveScanEnabled;
      chrome.storage.local.set({ passiveScanEnabled: next }, function () {
        togglePassiveButton.textContent = next ? "Passive Scan: ON" : "Passive Scan: OFF";
        togglePassiveButton.className = next ? "active" : "";
        setStatusText(next
          ? "Passive scanning ON.\nBrowse GlassBob property pages normally to collect them."
          : "Passive scanning OFF."
        );
        refreshPopupState();
      });
    });
  });

  scanButton.addEventListener("click", async function () {
    setStatusText("Scanning current page...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPropertyFromPage }, function (results) {
      if (chrome.runtime.lastError) { setStatusText("Error: " + chrome.runtime.lastError.message); return; }
      const found = results && results[0] ? results[0].result : null;
      if (!found || !found.looksLikePropertyPage) {
        setStatusText("This page does not look like a GlassBob property page.\n\nMake sure you are on an individual property listing.");
        return;
      }
      delete found.looksLikePropertyPage;
      savePropertyRecord(found);
    });
  });

  collectLinksButton.addEventListener("click", async function () {
    setStatusText("Collecting links...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractResultsLinksFromPage }, function (results) {
      if (chrome.runtime.lastError) { setStatusText("Error: " + chrome.runtime.lastError.message); return; }
      const foundLinks = results && results[0] ? results[0].result : null;

      if (!foundLinks || !foundLinks.length) {
        setStatusText("No property links found on this page.");
        return;
      }

      chrome.storage.local.get(["resultsQueue"], function (data) {
        const existingQueue = data.resultsQueue || [];
        const existingByUrl = {};
        existingQueue.forEach(function (item) { existingByUrl[item.url] = item; });

        let addedCount = 0;
        foundLinks.forEach(function (item) {
          if (!existingByUrl[item.url]) {
            existingQueue.push(item);
            existingByUrl[item.url] = item;
            addedCount++;
          }
        });

        chrome.storage.local.set({ resultsQueue: existingQueue }, function () {
          setStatusText(
            "Links collected.\nFound on page: " + foundLinks.length +
            "\nNew added: " + addedCount +
            "\nTotal queued: " + existingQueue.length
          );
          refreshPopupState();
        });
      });
    });
  });

  scanNextQueueButton.addEventListener("click", function () {
    scanNextQueuedLink();
  });

  viewQueueButton.addEventListener("click", function () {
    chrome.storage.local.get(["resultsQueue"], function (data) {
      renderQueueGrouped(data.resultsQueue || []);
    });
  });

  viewRoutesButton.addEventListener("click", function () {
    chrome.storage.local.get(["savedProperties"], function (data) {
      renderOutboundRoutes(data.savedProperties || []);
    });
  });

  viewButton.addEventListener("click", function () {
    chrome.storage.local.get(["savedProperties"], function (data) {
      const saved = data.savedProperties || [];
      setStatusText(saved.length ? JSON.stringify(saved, null, 2) : "No saved properties yet.");
    });
  });

  findChainsButton.addEventListener("click", function () {
    chrome.storage.local.get(["savedProperties"], function (data) {
      const saved = data.savedProperties || [];

      if (!saved.length) {
        setStatusText("No saved properties yet. Scan some GlassBob property pages first.");
        return;
      }

      setStatusText("Searching for swap chains...");
      const chains = findSwapChains(saved, 4);
      renderSwapChains(chains, saved.length);
    });
  });

  clearButton.addEventListener("click", function () {
    chrome.storage.local.set(
      { savedProperties: [], matchedProperties: [], resultsQueue: [], lastPassiveScan: null },
      function () {
        setStatusText("All saved data cleared.");
        refreshPopupState();
      }
    );
  });

    document.getElementById("scanAllQueue").addEventListener("click", function () {
    scanAllQueue();
  });

  document.getElementById("stopScan").addEventListener("click", function () {
    autoScanStopped = true;
    setStatusText("Stopping after current tab closes...");
  });


  refreshPopupState();
});
