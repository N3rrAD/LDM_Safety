const loginPanel = document.querySelector("#loginPanel");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#loginForm");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const refreshButton = document.querySelector("#refreshButton");
const notifyButton = document.querySelector("#notifyButton");
const peopleList = document.querySelector("#peopleList");
const linksList = document.querySelector("#linksList");
const lastRefresh = document.querySelector("#lastRefresh");
const securityPanel = document.querySelector("#securityPanel");
const passwordForm = document.querySelector("#passwordForm");
const currentPasswordInput = document.querySelector("#currentPasswordInput");
const newPasswordInput = document.querySelector("#newPasswordInput");
const passwordMessage = document.querySelector("#passwordMessage");
const updatedCount = document.querySelector("#updatedCount");
const staleCount = document.querySelector("#staleCount");
const totalCount = document.querySelector("#totalCount");
const recenterMapButton = document.querySelector("#recenterMapButton");
const aedCount = document.querySelector("#aedCount");
const aedForm = document.querySelector("#aedForm");
const aedNameInput = document.querySelector("#aedNameInput");
const aedLatInput = document.querySelector("#aedLatInput");
const aedLngInput = document.querySelector("#aedLngInput");
const aedNoteInput = document.querySelector("#aedNoteInput");
const aedMessage = document.querySelector("#aedMessage");
const aedList = document.querySelector("#aedList");
const gameStateForm = document.querySelector("#gameStateForm");
const cat1Toggle = document.querySelector("#cat1Toggle");
const normalMapInput = document.querySelector("#normalMapInput");
const cat1MapInput = document.querySelector("#cat1MapInput");
const gameStateMessage = document.querySelector("#gameStateMessage");
const gameStateUpdated = document.querySelector("#gameStateUpdated");
const gameMasterList = document.querySelector("#gameMasterList");
const gameMasterLinksList = document.querySelector("#gameMasterLinksList");

let map;
let markers = new Map();
let aedMarkers = new Map();
let gameMasterMarkers = new Map();
let aedLayer;
let firstLocationLoad = true;
let knownUpdates = new Map();
let latestBounds = [];
let mapHasAutoFit = false;
const staleMinutes = 30;
const liveMinutes = 2;

function token() {
  return sessionStorage.getItem("adminToken") || "";
}

function authHeaders() {
  return { authorization: `Bearer ${token()}` };
}

function timeAgo(iso) {
  if (!iso) return "Never";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function mapsLink(location) {
  return `https://www.google.com/maps?q=${location.lat},${location.lng}`;
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

function gameMasterIcon() {
  return L.divIcon({
    className: "gm-marker",
    html: "GM",
    iconSize: [42, 28],
    iconAnchor: [21, 28],
    popupAnchor: [0, -28]
  });
}

function displayUrl(value) {
  return value.replace(/^https?:\/\//, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isStale(location) {
  if (!location) return true;
  return Date.now() - new Date(location.updatedAt).getTime() > staleMinutes * 60 * 1000;
}

function isLive(location) {
  if (!location) return false;
  return Date.now() - new Date(location.updatedAt).getTime() <= liveMinutes * 60 * 1000;
}

function sendUpdateAlert(person) {
  const text = `${person.name} updated location`;
  if (Notification.permission === "granted") {
    new Notification(text, { body: `Updated ${timeAgo(person.location.updatedAt)}` });
  }
  playAlertTone();
}

function playAlertTone() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.22);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.24);
}

function ensureMap() {
  if (map) return;
  map = L.map("map", { zoomControl: true }).setView([1.3521, 103.8198], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
  aedLayer = L.markerClusterGroup
    ? L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 48 })
    : L.layerGroup();
  aedLayer.addTo(map);
}

function fitMapToLatestLocations() {
  if (!map || !latestBounds.length) return;
  map.fitBounds(latestBounds, { padding: [36, 36], maxZoom: 16 });
}

function updateLatestBounds(people = [], aeds = [], gameMasters = []) {
  latestBounds = [
    ...people.filter(person => person.location).map(person => [person.location.lat, person.location.lng]),
    ...gameMasters.filter(master => master.location).map(master => [master.location.lat, master.location.lng]),
    ...aeds.map(aed => [aed.lat, aed.lng])
  ];
  if (latestBounds.length && !mapHasAutoFit) {
    fitMapToLatestLocations();
    mapHasAutoFit = true;
  }
}

function renderGameState(gameState) {
  if (!gameStateForm || !gameState) return;
  cat1Toggle.checked = Boolean(gameState.cat1Active);
  normalMapInput.value = gameState.normalMapUrl || "";
  cat1MapInput.value = gameState.cat1MapUrl || "";
  gameStateUpdated.textContent = `${gameState.cat1Active ? "Cat 1 active" : "Normal mode"} · ${timeAgo(gameState.updatedAt)}`;
}

function renderGameMasters(gameMasters) {
  if (!gameMasterList) return;
  gameMasterList.innerHTML = "";
  gameMasters.forEach(master => {
    const location = master.location;
    const stale = isStale(location);
    const live = isLive(location);
    const row = document.createElement("article");
    row.className = stale ? "person-row stale" : live ? "person-row live" : "person-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(master.name)}</strong>
        <span>${location ? `${live ? "Live" : "Updated"} ${timeAgo(location.updatedAt)}` : "No location yet"}</span>
        ${stale ? `<em>${location ? `Over ${staleMinutes}m old` : "Needs check-in"}</em>` : ""}
      </div>
      <div class="row-actions">
        ${location ? `<a href="${mapsLink(location)}" target="_blank" rel="noreferrer">Map</a>` : ""}
      </div>
    `;
    gameMasterList.appendChild(row);

    if (!location) return;
    const latLng = [location.lat, location.lng];
    const popup = `
      <strong>${escapeHtml(master.name)}</strong><br>
      Game Master<br>
      Updated ${timeAgo(location.updatedAt)}<br>
      Accuracy: ${Math.round(location.accuracy)}m
    `;
    if (gameMasterMarkers.has(master.id)) {
      gameMasterMarkers.get(master.id).setLatLng(latLng).setPopupContent(popup);
    } else {
      gameMasterMarkers.set(master.id, L.marker(latLng, { icon: gameMasterIcon() }).addTo(map).bindPopup(popup));
    }
  });
}

function renderPeople(people) {
  peopleList.innerHTML = "";
  const stalePeople = people.filter(person => isStale(person.location));
  const updatedPeople = people.length - stalePeople.length;

  updatedCount.textContent = String(updatedPeople);
  staleCount.textContent = String(stalePeople.length);
  totalCount.textContent = String(people.length);

  people.forEach(person => {
    const location = person.location;
    const stale = isStale(location);
    const live = isLive(location);
    const previousUpdate = knownUpdates.get(person.id);
    if (!firstLocationLoad && location && knownUpdates.has(person.id) && previousUpdate !== location.updatedAt) {
      sendUpdateAlert(person);
    }
    knownUpdates.set(person.id, location?.updatedAt || null);

    const row = document.createElement("article");
    row.className = stale ? "person-row stale" : live ? "person-row live" : "person-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(person.name)}</strong>
        <span>${location ? `${live ? "Live" : "Updated"} ${timeAgo(location.updatedAt)}` : "No location yet"}</span>
        ${stale ? `<em>${location ? `Over ${staleMinutes}m old` : "Needs check-in"}</em>` : ""}
        ${location?.note ? `<small>${escapeHtml(location.note)}</small>` : ""}
      </div>
      <div class="row-actions">
        ${location ? `<a href="${mapsLink(location)}" target="_blank" rel="noreferrer">Map</a>` : ""}
      </div>
    `;
    peopleList.appendChild(row);

    if (!location) return;
    const latLng = [location.lat, location.lng];
    const popup = `
      <strong>${escapeHtml(person.name)}</strong><br>
      Updated ${timeAgo(location.updatedAt)}<br>
      Accuracy: ${Math.round(location.accuracy)}m
      ${location.note ? `<br>${escapeHtml(location.note)}` : ""}
    `;

    if (markers.has(person.id)) {
      markers.get(person.id).setLatLng(latLng).setPopupContent(popup);
    } else {
      markers.set(person.id, L.marker(latLng).addTo(map).bindPopup(popup));
    }
  });
  firstLocationLoad = false;
}

function renderAeds(aeds) {
  aedCount.textContent = String(aeds.length);
  aedList.innerHTML = "";
  const activeIds = new Set(aeds.map(aed => aed.id));

  for (const [id, marker] of aedMarkers.entries()) {
    if (!activeIds.has(id)) {
      aedLayer.removeLayer(marker);
      aedMarkers.delete(id);
    }
  }

  aeds.forEach(aed => {
    const popup = `
      <strong>${escapeHtml(aed.name)}</strong><br>
      AED location<br>
      ${aed.note ? `${escapeHtml(aed.note)}<br>` : ""}
      <a href="${mapsLink(aed)}" target="_blank" rel="noreferrer">Open in Google Maps</a>
    `;
    const latLng = [aed.lat, aed.lng];
    if (aedMarkers.has(aed.id)) {
      aedMarkers.get(aed.id).setLatLng(latLng).setPopupContent(popup);
    } else {
      const marker = L.marker(latLng, { icon: aedIcon() }).bindPopup(popup);
      aedMarkers.set(aed.id, marker);
      aedLayer.addLayer(marker);
    }
  });

  aeds.slice(0, 100).forEach(aed => {
    const row = document.createElement("article");
    row.className = "aed-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(aed.name)}</strong>
        <span>${escapeHtml(aed.note || `${aed.lat.toFixed(5)}, ${aed.lng.toFixed(5)}`)}</span>
      </div>
      <div class="row-actions">
        <a href="${mapsLink(aed)}" target="_blank" rel="noreferrer">Map</a>
        <button type="button" data-aed-id="${escapeHtml(aed.id)}">Delete</button>
      </div>
    `;
    aedList.appendChild(row);
  });

  if (aeds.length > 100) {
    const row = document.createElement("article");
    row.className = "aed-row muted-row";
    row.innerHTML = `<div><strong>${aeds.length - 100} more AEDs</strong><span>All AEDs are still shown as map pins/clusters.</span></div>`;
    aedList.appendChild(row);
  }
}

async function loadLocations() {
  ensureMap();
  const [locationsResponse, aedsResponse, gameMastersResponse, gameStateResponse] = await Promise.all([
    fetch("/api/locations", { headers: authHeaders() }),
    fetch("/api/aeds", { headers: authHeaders() }),
    fetch("/api/game-master/locations", { headers: authHeaders() }),
    fetch("/api/game-state", { headers: authHeaders() })
  ]);
  if ([locationsResponse, aedsResponse, gameMastersResponse, gameStateResponse].some(response => response.status === 401)) {
    sessionStorage.removeItem("adminToken");
    loginPanel.classList.remove("hidden");
    dashboard.classList.add("hidden");
    return;
  }
  const data = await locationsResponse.json();
  const aedData = await aedsResponse.json();
  const gameMasterData = await gameMastersResponse.json();
  const gameStateData = await gameStateResponse.json();
  renderPeople(data.people);
  renderAeds(aedData.aeds || []);
  renderGameMasters(gameMasterData.gameMasters || []);
  renderGameState(gameStateData.gameState);
  updateLatestBounds(data.people, aedData.aeds || [], gameMasterData.gameMasters || []);
  lastRefresh.textContent = `Refreshed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

async function loadAdminStatus() {
  const response = await fetch("/api/admin/status", { headers: authHeaders() });
  if (!response.ok) return;
  const data = await response.json();
  securityPanel.classList.toggle("hidden", !data.mustChangePassword);
}

async function loadLinks() {
  const response = await fetch("/api/team-links", { headers: authHeaders() });
  const data = await response.json();
  linksList.innerHTML = "";
  data.team.forEach(member => {
    const url = `${location.origin}${member.url}`;
    const item = document.createElement("article");
    item.className = "link-row";
    item.innerHTML = `
      <div class="link-main">
        <strong>${escapeHtml(member.name)}</strong>
        <a class="private-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(displayUrl(url))}</a>
      </div>
      <div class="link-actions">
        <a class="action-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open</a>
        <button class="copy-link" type="button" data-url="${escapeHtml(url)}">Copy</button>
      </div>
    `;
    linksList.appendChild(item);
  });

  if (!gameMasterLinksList) return;
  const gmResponse = await fetch("/api/game-master-links", { headers: authHeaders() });
  const gmData = await gmResponse.json();
  gameMasterLinksList.innerHTML = "";
  gmData.gameMasters.forEach(master => {
    const url = `${location.origin}${master.url}`;
    const item = document.createElement("article");
    item.className = "link-row";
    item.innerHTML = `
      <div class="link-main">
        <strong>${escapeHtml(master.name)}</strong>
        <a class="private-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(displayUrl(url))}</a>
      </div>
      <div class="link-actions">
        <a class="action-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open</a>
        <button class="copy-link" type="button" data-url="${escapeHtml(url)}">Copy</button>
      </div>
    `;
    gameMasterLinksList.appendChild(item);
  });
}

async function showDashboard() {
  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
  await loadAdminStatus();
  await loadLinks();
  await loadLocations();
  setInterval(loadLocations, 15000);
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginMessage.textContent = "Signing in...";
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: passwordInput.value })
  });
  const data = await response.json();
  if (!response.ok) {
    loginMessage.textContent = data.error || "Could not sign in";
    return;
  }
  sessionStorage.setItem("adminToken", data.token);
  loginMessage.textContent = "";
  securityPanel.classList.toggle("hidden", !data.admin?.mustChangePassword);
  await showDashboard();
});

passwordForm.addEventListener("submit", async event => {
  event.preventDefault();
  passwordMessage.textContent = "Updating password...";
  const response = await fetch("/api/admin/password", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      currentPassword: currentPasswordInput.value,
      newPassword: newPasswordInput.value
    })
  });
  const data = await response.json();
  if (!response.ok) {
    passwordMessage.textContent = data.error || "Could not update password";
    passwordMessage.className = "message error";
    return;
  }
  currentPasswordInput.value = "";
  newPasswordInput.value = "";
  passwordMessage.textContent = "Password updated.";
  passwordMessage.className = "message success";
  securityPanel.classList.add("hidden");
});

refreshButton.addEventListener("click", loadLocations);
recenterMapButton.addEventListener("click", fitMapToLatestLocations);

linksList.addEventListener("click", async event => {
  const button = event.target.closest(".copy-link");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.url);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Open link";
  }
  setTimeout(() => {
    button.textContent = "Copy";
  }, 1200);
});

gameMasterLinksList?.addEventListener("click", async event => {
  const button = event.target.closest(".copy-link");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.url);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Open link";
  }
  setTimeout(() => {
    button.textContent = "Copy";
  }, 1200);
});

aedForm.addEventListener("submit", async event => {
  event.preventDefault();
  aedMessage.textContent = "Adding AED...";
  aedMessage.className = "message";
  const response = await fetch("/api/aeds", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      name: aedNameInput.value,
      lat: aedLatInput.value,
      lng: aedLngInput.value,
      note: aedNoteInput.value
    })
  });
  const data = await response.json();
  if (!response.ok) {
    aedMessage.textContent = data.error || "Could not add AED";
    aedMessage.className = "message error";
    return;
  }
  aedForm.reset();
  aedMessage.textContent = "AED added.";
  aedMessage.className = "message success";
  await loadLocations();
});

aedList.addEventListener("click", async event => {
  const button = event.target.closest("[data-aed-id]");
  if (!button) return;
  const response = await fetch(`/api/aeds?id=${encodeURIComponent(button.dataset.aedId)}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (response.ok) {
    await loadLocations();
  }
});

gameStateForm?.addEventListener("submit", async event => {
  event.preventDefault();
  gameStateMessage.textContent = "Saving game map mode...";
  gameStateMessage.className = "message";
  const response = await fetch("/api/game-state", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      cat1Active: cat1Toggle.checked,
      normalMapUrl: normalMapInput.value,
      cat1MapUrl: cat1MapInput.value
    })
  });
  const data = await response.json();
  if (!response.ok) {
    gameStateMessage.textContent = data.error || "Could not save game map mode";
    gameStateMessage.className = "message error";
    return;
  }
  renderGameState(data.gameState);
  gameStateMessage.textContent = "Game Master phones will switch automatically.";
  gameStateMessage.className = "message success";
});

notifyButton.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    notifyButton.textContent = "X";
    return;
  }
  const permission = await Notification.requestPermission();
  notifyButton.classList.toggle("active", permission === "granted");
});

if (token()) {
  showDashboard();
}
