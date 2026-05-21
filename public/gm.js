const gmParams = new URLSearchParams(location.search);
const gmToken = gmParams.get("t") || "";
const gmName = document.querySelector("#gmName");
const cat1Badge = document.querySelector("#cat1Badge");
const mapTitle = document.querySelector("#mapTitle");
const mapUpdated = document.querySelector("#mapUpdated");
const mapLink = document.querySelector("#mapLink");
const mapPlaceholder = document.querySelector("#mapPlaceholder");
const gmNoteInput = document.querySelector("#gmNoteInput");
const gmUpdateButton = document.querySelector("#gmUpdateButton");
const gmStatusMessage = document.querySelector("#gmStatusMessage");
const gmLiveIntervalMs = 30000;
const gmStateIntervalMs = 2000;
let gmWatchId = null;
let gmRetryTimer = null;
let gmStateTimer = null;
let gmLastSentAt = 0;
let gmMap = null;
let gmKmlLayer = null;
let gmUserMarker = null;
let activeMapUrl = "";
let activeStateSignature = "";

const stationStyles = {
  "bridgewatch under pressure": { color: "#f97316", short: "BW" },
  "capture the cup": { color: "#6d4bd8", short: "CC" },
  "dead reckoning": { color: "#f05a28", short: "DR" },
  "full salvo": { color: "#c2185b", short: "FS" },
  "keepy uppy": { color: "#5d4037", short: "KU" },
  "knot showdown": { color: "#4b5563", short: "KS" },
  "marker maze": { color: "#283593", short: "MM" },
  "minefield": { color: "#b93220", short: "MF" },
  "sea state 5": { color: "#0284c7", short: "S5" },
  "shuttle siege": { color: "#795548", short: "SS" },
  "silent convoy": { color: "#6b6f15", short: "SC" },
  "superstructure": { color: "#facc15", short: "ST" },
  "triple p": { color: "#0f8f5f", short: "TP" },
  "underway": { color: "#0ea5e9", short: "UW" }
};

function setGmStatus(message, tone = "") {
  gmStatusMessage.textContent = message;
  gmStatusMessage.className = `message ${tone}`;
}

function gmTimeAgo(iso) {
  if (!iso) return "Waiting";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function getGmPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GPS is not supported by this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    });
  });
}

function ensureGmMap() {
  if (gmMap) return;
  gmMap = L.map("gmGameMap", { zoomControl: true }).setView([1.3521, 103.8198], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(gmMap);
  setTimeout(() => gmMap.invalidateSize(), 0);
}

function gmLocationIcon() {
  return L.divIcon({
    className: "gm-location-marker",
    html: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stationKey(name = "") {
  return String(name).replace(/\s*\(SI\)\s*$/i, "").trim().toLowerCase();
}

function stationIcon(name) {
  const style = stationStyles[stationKey(name)] || { color: "#3157c9", short: "GM" };
  return L.divIcon({
    className: "station-marker",
    html: `
      <span class="station-pin" style="background:${style.color}"><span class="station-code">${escapeHtml(style.short)}</span></span>
      <span class="station-label">${escapeHtml(name)}</span>
    `,
    iconSize: [170, 42],
    iconAnchor: [15, 34],
    popupAnchor: [0, -34]
  });
}

function styleKmlFeature(feature) {
  const name = feature?.properties?.name || "";
  const station = stationStyles[stationKey(name)];
  if (!station) return {};
  return {
    color: station.color,
    fillColor: station.color,
    fillOpacity: 0.18,
    opacity: 0.85,
    weight: 3
  };
}

function createKmlLayer() {
  const seenStations = new Set();
  return L.geoJson(null, {
    filter: feature => {
      if (feature?.geometry?.type !== "Point") return true;
      const key = stationKey(feature?.properties?.name);
      if (!stationStyles[key]) return true;
      if (seenStations.has(key)) return false;
      seenStations.add(key);
      return true;
    },
    pointToLayer: (feature, latLng) => {
      const name = feature?.properties?.name || "Game station";
      return L.marker(latLng, { icon: stationIcon(name), zIndexOffset: 500 });
    },
    style: styleKmlFeature,
    onEachFeature: (feature, layer) => {
      const name = feature?.properties?.name;
      if (name) layer.bindPopup(`<strong>${escapeHtml(name)}</strong>`);
    }
  });
}

function updateGmUserMarker(position) {
  ensureGmMap();
  const latLng = [position.coords.latitude, position.coords.longitude];
  if (gmUserMarker) {
    gmUserMarker.setLatLng(latLng);
  } else {
    gmUserMarker = L.marker(latLng, { icon: gmLocationIcon() }).addTo(gmMap).bindPopup("Your location");
  }
}

function versionedMapUrl(mapUrl, updatedAt) {
  if (!updatedAt) return mapUrl;
  return `${mapUrl}${mapUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(updatedAt)}`;
}

function loadKmlMap(mapUrl, updatedAt) {
  ensureGmMap();
  const nextMapUrl = versionedMapUrl(mapUrl, updatedAt);
  if (!mapUrl || nextMapUrl === activeMapUrl) return;
  activeMapUrl = nextMapUrl;
  mapPlaceholder.classList.remove("hidden");
  mapPlaceholder.querySelector("strong").textContent = "Loading map";
  mapPlaceholder.querySelector("span").textContent = "Opening the active KML game map...";

  if (gmKmlLayer) {
    gmMap.removeLayer(gmKmlLayer);
    gmKmlLayer = null;
  }

  gmKmlLayer = omnivore.kml(nextMapUrl, null, createKmlLayer())
    .on("ready", () => {
      mapPlaceholder.classList.add("hidden");
      const bounds = gmKmlLayer.getBounds();
      if (bounds.isValid()) {
        gmMap.fitBounds(bounds, { padding: [20, 20], maxZoom: 18 });
      }
      if (gmUserMarker) gmUserMarker.addTo(gmMap);
      setTimeout(() => gmMap.invalidateSize(), 0);
    })
    .on("error", () => {
      mapPlaceholder.classList.remove("hidden");
      mapPlaceholder.querySelector("strong").textContent = "Map could not load";
      mapPlaceholder.querySelector("span").textContent = "Ask admin to check the KML map link.";
    })
    .addTo(gmMap);
}

function renderGameState(gameState) {
  const isCat1 = Boolean(gameState.cat1Active);
  const mapUrl = isCat1 ? gameState.cat1MapUrl : gameState.normalMapUrl;
  const nextSignature = `${isCat1}|${gameState.normalMapUrl}|${gameState.cat1MapUrl}|${gameState.updatedAt}`;
  if (nextSignature === activeStateSignature) return;
  activeStateSignature = nextSignature;
  cat1Badge.textContent = isCat1 ? "CAT 1" : "Normal";
  cat1Badge.classList.toggle("cat1", isCat1);
  mapTitle.textContent = isCat1 ? "Cat 1 Map" : "Normal Game Map";
  mapUpdated.textContent = `Updated ${gmTimeAgo(gameState.updatedAt)}`;

  if (mapUrl) {
    mapLink.href = mapUrl;
    mapLink.classList.remove("hidden");
    loadKmlMap(mapUrl, gameState.updatedAt);
  } else {
    mapPlaceholder.classList.remove("hidden");
    mapPlaceholder.querySelector("strong").textContent = isCat1 ? "Cat 1 Holding Map" : "Normal Game Map";
    mapPlaceholder.querySelector("span").textContent = isCat1
      ? "Admin has switched Cat 1 on. Add a Cat 1 map URL in the admin dashboard."
      : "Add a normal game map URL in the admin dashboard.";
    mapLink.removeAttribute("href");
    mapLink.classList.add("hidden");
  }
}

async function loadGameMaster() {
  const response = await fetch(`/api/game-master/me?token=${encodeURIComponent(gmToken)}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "This Game Master link is not active.");
  gmName.textContent = data.name;
  renderGameState(data.gameState);
}

async function sendGmPosition(position) {
  const now = Date.now();
  if (now - gmLastSentAt < gmLiveIntervalMs - 1000) return;
  gmLastSentAt = now;
  setGmStatus("Sending live GPS update...");
  const response = await fetch("/api/game-master/location", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: gmToken,
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      note: gmNoteInput.value
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not save location.");
  setGmStatus(`Live tracking. Last update ${new Date(data.location.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`, "success");
}

function stopGmTracking() {
  if (gmWatchId !== null) {
    navigator.geolocation.clearWatch(gmWatchId);
    gmWatchId = null;
  }
  if (gmRetryTimer) {
    clearInterval(gmRetryTimer);
    gmRetryTimer = null;
  }
}

function startGmTracking() {
  stopGmTracking();
  if (!navigator.geolocation) {
    setGmStatus("GPS is not supported by this browser.", "error");
    return;
  }
  gmUpdateButton.disabled = true;
  setGmStatus("Starting live GPS tracking...");
  gmWatchId = navigator.geolocation.watchPosition(
    async position => {
      try {
        gmUpdateButton.disabled = false;
        updateGmUserMarker(position);
        await sendGmPosition(position);
      } catch (error) {
        setGmStatus(error.message || "Could not send GPS update.", "error");
      }
    },
    error => {
      gmUpdateButton.disabled = false;
      setGmStatus(error.message || "Location permission is required for live tracking.", "error");
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 10000
    }
  );

  gmRetryTimer = setInterval(async () => {
    if (Date.now() - gmLastSentAt < gmLiveIntervalMs) return;
    try {
      const position = await getGmPosition();
      updateGmUserMarker(position);
      await sendGmPosition(position);
    } catch (error) {
      setGmStatus(error.message || "Waiting for GPS permission/location.", "error");
    }
  }, gmLiveIntervalMs);
}

async function bootGameMaster() {
  if (!gmToken) {
    gmName.textContent = "Invalid Link";
    gmUpdateButton.disabled = true;
    setGmStatus("Ask the admin for your private Game Master link.", "error");
    return;
  }
  try {
    await loadGameMaster();
    startGmTracking();
    gmStateTimer = setInterval(loadGameMaster, gmStateIntervalMs);
  } catch (error) {
    gmName.textContent = "Invalid Link";
    gmUpdateButton.disabled = true;
    setGmStatus(error.message || "This Game Master link is not active.", "error");
  }
}

gmUpdateButton.addEventListener("click", startGmTracking);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && gmToken) {
    loadGameMaster().catch(() => {});
    startGmTracking();
  }
});

bootGameMaster();
