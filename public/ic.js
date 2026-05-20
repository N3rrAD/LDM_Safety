const params = new URLSearchParams(location.search);
const icToken = params.get("t") || "";
const personName = document.querySelector("#personName");
const updateButton = document.querySelector("#updateButton");
const statusMessage = document.querySelector("#statusMessage");
const noteInput = document.querySelector("#noteInput");
const nearestAedCard = document.querySelector("#nearestAedCard");
const nearestAedName = document.querySelector("#nearestAedName");
const nearestAedDistance = document.querySelector("#nearestAedDistance");
const nearestAedNote = document.querySelector("#nearestAedNote");
const nearestAedDirections = document.querySelector("#nearestAedDirections");
const nearbyAedList = document.querySelector("#nearbyAedList");
const liveIntervalMs = 30000;
let watchId = null;
let lastSentAt = 0;
let lastAedLookupAt = 0;
let retryTimer = null;
let icAedMap = null;
let userMarker = null;
let nearestAedMarkers = [];

function setStatus(message, tone = "") {
  statusMessage.textContent = message;
  statusMessage.className = `message ${tone}`;
}

function getPosition() {
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "--";
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function directionsLink(fromLat, fromLng, toLat, toLng) {
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=walking`;
}

function aedIcon() {
  return L.divIcon({
    className: "aed-marker",
    html: "AED",
    iconSize: [42, 28],
    iconAnchor: [21, 28],
    popupAnchor: [0, -28]
  });
}

function ensureAedMap(lat, lng) {
  nearestAedCard.classList.remove("hidden");
  if (icAedMap) return;
  icAedMap = L.map("icAedMap", { zoomControl: true }).setView([lat, lng], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(icAedMap);
  setTimeout(() => icAedMap.invalidateSize(), 0);
}

async function safelyUpdateNearestAeds(position) {
  try {
    await updateNearestAeds(position);
  } catch (error) {
    nearestAedCard.classList.remove("hidden");
    nearestAedName.textContent = "AED lookup unavailable";
    nearestAedDistance.textContent = "--";
    nearestAedNote.textContent = error.message || "Could not load nearby AEDs.";
    nearbyAedList.innerHTML = "";
  }
}

async function updateNearestAeds(position) {
  const now = Date.now();
  if (now - lastAedLookupAt < liveIntervalMs - 1000) return;
  lastAedLookupAt = now;
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  ensureAedMap(lat, lng);

  const response = await fetch(`/api/aeds/nearest?token=${encodeURIComponent(icToken)}&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load nearby AEDs.");
  const nearest = data.nearest || [];
  if (!nearest.length) {
    nearestAedName.textContent = "No AED found";
    nearestAedDistance.textContent = "--";
    nearestAedNote.textContent = "No AED locations are available yet.";
    nearbyAedList.innerHTML = "";
    return;
  }

  const first = nearest[0];
  nearestAedName.textContent = first.name;
  nearestAedDistance.textContent = formatDistance(first.distanceMeters);
  nearestAedNote.textContent = first.note || "AED location available.";
  nearestAedDirections.href = directionsLink(lat, lng, first.lat, first.lng);

  const userLatLng = [lat, lng];
  if (userMarker) {
    userMarker.setLatLng(userLatLng);
  } else {
    userMarker = L.marker(userLatLng).addTo(icAedMap).bindPopup("Your location");
  }

  nearestAedMarkers.forEach(marker => marker.remove());
  nearestAedMarkers = nearest.slice(0, 5).map(aed => L.marker([aed.lat, aed.lng], { icon: aedIcon() })
    .addTo(icAedMap)
    .bindPopup(`<strong>${escapeHtml(aed.name)}</strong><br>${formatDistance(aed.distanceMeters)} away<br>${escapeHtml(aed.note || "")}`));

  const bounds = L.latLngBounds([userLatLng, ...nearest.slice(0, 5).map(aed => [aed.lat, aed.lng])]);
  icAedMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });

  nearbyAedList.innerHTML = nearest.slice(0, 5).map(aed => `
    <article class="nearby-aed-row">
      <div>
        <strong>${escapeHtml(aed.name)}</strong>
        <span>${formatDistance(aed.distanceMeters)} away</span>
      </div>
      <a href="${directionsLink(lat, lng, aed.lat, aed.lng)}" target="_blank" rel="noreferrer">Directions</a>
    </article>
  `).join("");
}

async function sendPosition(position) {
  const now = Date.now();
  if (now - lastSentAt < liveIntervalMs - 1000) return;
  lastSentAt = now;
  setStatus("Sending live GPS update...");
  const response = await fetch("/api/location", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: icToken,
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      note: noteInput.value
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not save location.");
  setStatus(`Live tracking. Last update ${new Date(data.location.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`, "success");
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

function startTracking() {
  stopTracking();
  if (!navigator.geolocation) {
    setStatus("GPS is not supported by this browser.", "error");
    return;
  }
  updateButton.disabled = true;
  setStatus("Starting live GPS tracking...");
  watchId = navigator.geolocation.watchPosition(
    async position => {
      try {
        updateButton.disabled = false;
        await safelyUpdateNearestAeds(position);
        await sendPosition(position);
      } catch (error) {
        setStatus(error.message || "Could not send GPS update.", "error");
      }
    },
    error => {
      updateButton.disabled = false;
      setStatus(error.message || "Location permission is required for live tracking.", "error");
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 10000
    }
  );

  retryTimer = setInterval(async () => {
    if (Date.now() - lastSentAt < liveIntervalMs) return;
    try {
      const position = await getPosition();
      await safelyUpdateNearestAeds(position);
      await sendPosition(position);
    } catch (error) {
      setStatus(error.message || "Waiting for GPS permission/location.", "error");
    }
  }, liveIntervalMs);
}

async function loadMe() {
  if (!icToken) {
    personName.textContent = "Invalid Link";
    updateButton.disabled = true;
    setStatus("Ask the admin for your private IC link.", "error");
    return;
  }
  const response = await fetch(`/api/me?token=${encodeURIComponent(icToken)}`);
  const data = await response.json();
  if (!response.ok) {
    personName.textContent = "Invalid Link";
    updateButton.disabled = true;
    setStatus(data.error || "This IC link is not active.", "error");
    return;
  }
  personName.textContent = data.name;
  startTracking();
}

updateButton.addEventListener("click", startTracking);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && icToken) startTracking();
});

loadMe();
