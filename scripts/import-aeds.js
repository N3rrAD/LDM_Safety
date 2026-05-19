const fs = require("fs/promises");
const crypto = require("crypto");

const csvPath = process.argv[2];
const baseUrl = (process.argv[3] || "https://ldm-location-dashboard.vercel.app").replace(/\/$/, "");
const password = process.argv[4];
const cachePath = "data/aed-geocode-cache.json";

if (!csvPath || !password) {
  console.error("Usage: node scripts/import-aeds.js <AEDLocations.csv> <baseUrl> <adminPassword>");
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }

  const [headers, ...dataRows] = rows;
  return dataRows
    .filter(dataRow => dataRow.some(Boolean))
    .map(dataRow => Object.fromEntries(headers.map((header, index) => [header, dataRow[index] || ""])));
}

async function geocodePostal(postal) {
  const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(postal)}&returnGeom=Y&getAddrDetails=Y`;
  const response = await fetch(url);
  const data = await response.json();
  const result = (data.results || []).find(item => item.POSTAL === postal) || data.results?.[0];
  if (!result?.LATITUDE || !result?.LONGITUDE) return null;
  return {
    lat: Number(result.LATITUDE),
    lng: Number(result.LONGITUDE)
  };
}

async function main() {
  const csv = await fs.readFile(csvPath, "utf8");
  const rows = parseCsv(csv);
  const uniquePostals = [...new Set(rows.map(row => row.Postal_Code).filter(Boolean))];
  const cache = JSON.parse(await fs.readFile(cachePath, "utf8").catch(() => "{}"));
  const geocoded = new Map(Object.entries(cache));
  const unresolved = [];
  const pendingPostals = uniquePostals.filter(postal => !geocoded.has(postal));

  for (let start = 0; start < pendingPostals.length; start += 1) {
    const batch = pendingPostals.slice(start, start + 1);
    await Promise.all(batch.map(async postal => {
      try {
        const location = await geocodePostal(postal);
        if (location) {
          geocoded.set(postal, location);
          cache[postal] = location;
        } else {
          unresolved.push(postal);
        }
      } catch {
        unresolved.push(postal);
      }
    }));
    if ((start + batch.length) % 250 === 0 || start + batch.length >= pendingPostals.length) {
      await fs.mkdir("data", { recursive: true });
      await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
      console.log(`Geocoded ${Math.min(start + batch.length, pendingPostals.length)}/${pendingPostals.length} pending postal codes`);
    }
    await new Promise(resolve => setTimeout(resolve, 35));
  }

  const aeds = rows
    .map((row, index) => {
      const location = geocoded.get(row.Postal_Code);
      if (!location) return null;
      const name = row.Building_Name || "AED";
      const noteParts = [row.Location_Description, `Postal ${row.Postal_Code}`].filter(Boolean);
      const id = crypto.createHash("sha1").update(`${row.Postal_Code}|${name}|${row.Location_Description}|${index}`).digest("hex").slice(0, 18);
      return {
        id,
        name,
        lat: location.lat,
        lng: location.lng,
        note: noteParts.join(" | ")
      };
    })
    .filter(Boolean);

  const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  const login = await loginResponse.json();
  if (!loginResponse.ok) throw new Error(login.error || "Admin login failed");

  const importResponse = await fetch(`${baseUrl}/api/aeds/bulk`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${login.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ aeds })
  });
  const result = await importResponse.json();
  if (!importResponse.ok) throw new Error(result.error || "AED import failed");

  console.log(JSON.stringify({
    csvRows: rows.length,
    uniquePostals: uniquePostals.length,
    imported: result.count,
    skippedInvalidCoordinates: result.skipped,
    unresolvedPostals: unresolved.length
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
