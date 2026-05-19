const params = new URLSearchParams(location.search);
const icToken = params.get("t") || "";
const personName = document.querySelector("#personName");
const updateButton = document.querySelector("#updateButton");
const statusMessage = document.querySelector("#statusMessage");
const noteInput = document.querySelector("#noteInput");

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
}

updateButton.addEventListener("click", async () => {
  updateButton.disabled = true;
  setStatus("Getting your GPS location...");
  try {
    const position = await getPosition();
    setStatus("Sending location...");
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
    setStatus(`Location updated at ${new Date(data.location.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`, "success");
  } catch (error) {
    setStatus(error.message || "Could not update location.", "error");
  } finally {
    updateButton.disabled = false;
  }
});

loadMe();
