const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const db = new Database("swaps.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT UNIQUE,
    source_site TEXT,
    source_url TEXT,
    area TEXT,
    postcode_area TEXT,
    bedrooms TEXT,
    property_type TEXT,
    wanted_locations TEXT,
    first_seen TEXT,
    last_seen TEXT
  )
`);

function fingerprint(sourceUrl) {
  return crypto.createHash("sha256").update(sourceUrl).digest("hex");
}

function normaliseArea(area) {
  return (area || "").toLowerCase().trim();
}

function findSwapChains(properties, maxDepth) {
  maxDepth = maxDepth || 4;
  const byArea = {};

  properties.forEach(function (prop) {
    const area = normaliseArea(prop.area);
    if (!area || area === "unknown area") return;
    if (!byArea[area]) byArea[area] = [];
    byArea[area].push(prop);
  });

  const chains = [];
  const chainSignatures = {};

  function search(chain, visitedAreas) {
    const current = chain[chain.length - 1];
    const wanted = Array.isArray(current.wanted_locations)
      ? current.wanted_locations
      : JSON.parse(current.wanted_locations || "[]");

    wanted.forEach(function (wantedTown) {
      const key = normaliseArea(wantedTown);
      const originArea = normaliseArea(chain[0].area);

      if (key === originArea && chain.length > 1) {
        const signature = chain.map(function (p) { return p.source_url; }).sort().join("|");
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

  properties.forEach(function (startProp) {
    const startArea = normaliseArea(startProp.area);
    if (!startArea || startArea === "unknown area") return;
    const visited = {};
    visited[startArea] = true;
    search([startProp], visited);
  });

  chains.sort(function (a, b) {
    if (a.length !== b.length) return a.length - b.length;
    return a[0].area.localeCompare(b[0].area);
  });

  return chains;
}

app.get("/", function (req, res) {
  res.json({ status: "ok", name: "Swap Path Finder API" });
});

app.get("/stats", function (req, res) {
  const total = db.prepare("SELECT COUNT(*) as count FROM properties").get();
  const bySite = db.prepare("SELECT source_site, COUNT(*) as count FROM properties GROUP BY source_site").all();
  const recentCount = db.prepare("SELECT COUNT(*) as count FROM properties WHERE last_seen >= datetime('now', '-7 days')").get();
  res.json({ total_properties: total.count, by_site: bySite, active_last_7_days: recentCount.count });
});

app.post("/property", function (req, res) {
  const body = req.body;
  if (!body.source_url) return res.status(400).json({ error: "source_url is required" });
  if (!body.area && !body.postcode_area) return res.status(400).json({ error: "area or postcode_area is required" });
  const wanted = Array.isArray(body.wanted_locations) ? body.wanted_locations : [];
  if (!wanted.length) return res.status(400).json({ error: "wanted_locations must be a non-empty array" });

  const fp = fingerprint(body.source_url);
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM properties WHERE fingerprint = ?").get(fp);

  if (existing) {
    db.prepare("UPDATE properties SET last_seen = ?, bedrooms = ?, wanted_locations = ? WHERE fingerprint = ?").run(now, body.bedrooms || "", JSON.stringify(wanted), fp);
    return res.json({ status: "updated", fingerprint: fp });
  }

  db.prepare(`
    INSERT INTO properties (fingerprint, source_site, source_url, area, postcode_area, bedrooms, property_type, wanted_locations, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fp, body.source_site || "unknown", body.source_url, body.area || "", body.postcode_area || "", body.bedrooms || "", body.property_type || "", JSON.stringify(wanted), now, now);

  return res.json({ status: "created", fingerprint: fp });
});

app.get("/chains", function (req, res) {
  const maxDepth = Math.min(parseInt(req.query.max_depth) || 4, 5);
  const properties = db.prepare("SELECT * FROM properties WHERE last_seen >= datetime('now', '-90 days')").all();
  if (!properties.length) return res.json({ chains: [], property_count: 0 });

  const chains = findSwapChains(properties, maxDepth);
  const formatted = chains.map(function (chain) {
    return {
      length: chain.length,
      route: chain.map(function (p) { return p.area; }).join(" → ") + " → 🔁",
      properties: chain.map(function (p) {
        return {
          area: p.area,
          postcode_area: p.postcode_area,
          bedrooms: p.bedrooms,
          property_type: p.property_type,
          source_url: p.source_url,
          wanted_locations: JSON.parse(p.wanted_locations || "[]")
        };
      })
    };
  });

  res.json({ chains: formatted, chain_count: formatted.length, property_count: properties.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Swap Path Finder server running on port " + PORT);
});