const params = new URLSearchParams(location.search);
const icToken = params.get("t") || "";
const personName = document.querySelector("#personName");
const updateButton = document.querySelector("#updateButton");
const statusMessage = document.querySelector("#statusMessage");
const noteInput = document.querySelector("#noteInput");
const liveIntervalMs = 30000;
let watchId = null;
let lastSentAt = 0;
let retryTimer = null;

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
