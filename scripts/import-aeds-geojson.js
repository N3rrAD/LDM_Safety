const fs = require("fs/promises");

const geojsonPath = process.argv[2];
const baseUrl = (process.argv[3] || "https://ldm-location-dashboard.vercel.app").replace(/\/$/, "");
const password = process.argv[4];

if (!geojsonPath || !password) {
  console.error("Usage: node scripts/import-aeds-geojson.js <PublicAccessAEDs.geojson> <baseUrl> <adminPassword>");
  process.exit(1);
}

async function main() {
  const geojson = JSON.parse(await fs.readFile(geojsonPath, "utf8"));
  const aeds = (geojson.features || []).map((feature, index) => {
    const properties = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || [];
    const lng = Number(properties.LONGITUDE ?? coordinates[0]);
    const lat = Number(properties.LATITUDE ?? coordinates[1]);
    const name = properties.BUILDING_NAME || properties.ROAD_NAME || "AED";
    const noteParts = [
      properties.AED_LOCATION_DESCRIPTION,
      properties.AED_LOCATION_FLOOR_LEVEL ? `Level ${properties.AED_LOCATION_FLOOR_LEVEL}` : "",
      properties.POSTAL_CODE ? `Postal ${properties.POSTAL_CODE}` : "",
      properties.OPERATING_HOURS ? `Hours ${properties.OPERATING_HOURS}` : ""
    ].filter(Boolean);
    return {
      id: String(properties.AED_ID || properties.OBJECTID || `aed-${index}`),
      name,
      lat,
      lng,
      note: noteParts.join(" | ")
    };
  }).filter(aed => Number.isFinite(aed.lat) && Number.isFinite(aed.lng));

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
    sourceFeatures: geojson.features?.length || 0,
    imported: result.count,
    skippedInvalidCoordinates: result.skipped
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
