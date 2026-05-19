const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const SESSION_HOURS = 12;
const PBKDF2_ITERATIONS = 210000;
const DATA_DIR = path.join(__dirname, "data");
const TEAM_FILE = path.join(DATA_DIR, "team.json");
const LOCATIONS_FILE = path.join(DATA_DIR, "locations.json");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const HAS_REDIS = Boolean(REDIS_URL && REDIS_TOKEN);
const IS_VERCEL = Boolean(process.env.VERCEL);
const STORE_PREFIX = process.env.STORE_PREFIX || "ldm-location";
const STORE_KEYS = {
  team: `${STORE_PREFIX}:team`,
  locations: `${STORE_PREFIX}:locations`,
  admin: `${STORE_PREFIX}:admin`
};

const adminSessions = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function createStarterTeam() {
  return [
    { id: "alpha", name: "Alpha IC" },
    { id: "bravo", name: "Bravo IC" },
    { id: "charlie", name: "Charlie IC" },
    { id: "delta", name: "Delta IC" },
    { id: "echo", name: "Echo IC" },
    { id: "foxtrot", name: "Foxtrot IC" },
    { id: "golf", name: "Golf IC" },
    { id: "hotel", name: "Hotel IC" },
    { id: "india", name: "India IC" },
    { id: "juliet", name: "Juliet IC" }
  ].map(member => ({
    ...member,
    token: crypto.randomBytes(18).toString("hex")
  }));
}

async function ensureDataFiles() {
  if (HAS_REDIS) {
    await ensureRemoteData();
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(TEAM_FILE);
  } catch {
    await writeJson(TEAM_FILE, createStarterTeam());
  }
  try {
    await fs.access(LOCATIONS_FILE);
  } catch {
    await writeJson(LOCATIONS_FILE, { latest: {}, history: [] });
  }
  try {
    await fs.access(ADMIN_FILE);
  } catch {
    await writeJson(ADMIN_FILE, createPasswordRecord(ADMIN_PASSWORD, ADMIN_PASSWORD === "change-me"));
  }
}

async function ensureRemoteData() {
  if (!(await readStore("team", null))) {
    await writeStore("team", await readJson(TEAM_FILE, createStarterTeam()));
  }
  if (!(await readStore("locations", null))) {
    await writeStore("locations", { latest: {}, history: [] });
  }
  if (!(await readStore("admin", null))) {
    await writeStore("admin", createPasswordRecord(ADMIN_PASSWORD, ADMIN_PASSWORD === "change-me"));
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function redisCommand(command) {
  const response = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${REDIS_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `Redis command failed: ${response.status}`);
  }
  return data.result;
}

async function readStore(name, fallback) {
  if (HAS_REDIS) {
    const result = await redisCommand(["GET", STORE_KEYS[name]]);
    if (result === null || result === undefined) return fallback;
    return typeof result === "string" ? JSON.parse(result) : result;
  }

  const files = {
    team: TEAM_FILE,
    locations: LOCATIONS_FILE,
    admin: ADMIN_FILE
  };
  return readJson(files[name], fallback);
}

async function writeStore(name, value) {
  if (HAS_REDIS) {
    await redisCommand(["SET", STORE_KEYS[name], JSON.stringify(value)]);
    return;
  }
  if (IS_VERCEL) {
    throw new Error("Persistent storage is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.");
  }

  const files = {
    team: TEAM_FILE,
    locations: LOCATIONS_FILE,
    admin: ADMIN_FILE
  };
  await writeJson(files[name], value);
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
}

function createPasswordRecord(password, mustChangePassword = false) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    salt,
    passwordHash: hashPassword(password, salt),
    mustChangePassword,
    updatedAt: new Date().toISOString()
  };
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function verifyAdminPassword(password) {
  const admin = await readStore("admin", null);
  if (!admin?.salt || !admin?.passwordHash) return false;
  return timingSafeEqualHex(hashPassword(String(password || ""), admin.salt), admin.passwordHash);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

async function getTeamMemberByToken(token) {
  const team = await readStore("team", []);
  return team.find(member => member.token === token);
}

function isValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function createAdminSession() {
  const token = crypto.randomBytes(24).toString("hex");
  const ttlSeconds = SESSION_HOURS * 60 * 60;
  if (HAS_REDIS) {
    await redisCommand(["SET", `${STORE_PREFIX}:session:${token}`, "1", "EX", String(ttlSeconds)]);
  } else {
    adminSessions.set(token, Date.now() + ttlSeconds * 1000);
  }
  return token;
}

async function isAdmin(req) {
  const token = getBearerToken(req);
  if (HAS_REDIS) {
    return Boolean(await redisCommand(["GET", `${STORE_PREFIX}:session:${token}`]));
  }
  const expiry = adminSessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

async function adminStatus() {
  const admin = await readStore("admin", {});
  return {
    mustChangePassword: Boolean(admin.mustChangePassword),
    sessionHours: SESSION_HOURS,
    storage: HAS_REDIS ? "upstash" : "local"
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === "POST" && pathname === "/api/admin/login") {
    const body = await parseBody(req);
    if (!(await verifyAdminPassword(body.password))) {
      sendJson(res, 401, { error: "Wrong admin password" });
      return;
    }
    const token = await createAdminSession();
    sendJson(res, 200, { token, admin: await adminStatus() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/status") {
    if (!(await isAdmin(req))) {
      sendJson(res, 401, { error: "Admin login required" });
      return;
    }
    sendJson(res, 200, await adminStatus());
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/password") {
    if (!(await isAdmin(req))) {
      sendJson(res, 401, { error: "Admin login required" });
      return;
    }
    const body = await parseBody(req);
    if (!(await verifyAdminPassword(body.currentPassword))) {
      sendJson(res, 401, { error: "Current password is wrong" });
      return;
    }
    const nextPassword = String(body.newPassword || "");
    if (nextPassword.length < 10) {
      sendJson(res, 400, { error: "Use at least 10 characters" });
      return;
    }
    await writeStore("admin", createPasswordRecord(nextPassword, false));
    sendJson(res, 200, { ok: true, admin: await adminStatus() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/team-links") {
    if (!(await isAdmin(req))) {
      sendJson(res, 401, { error: "Admin login required" });
      return;
    }
    const team = await readStore("team", []);
    sendJson(res, 200, {
      team: team.map(member => ({
        id: member.id,
        name: member.name,
        url: `/ic.html?t=${encodeURIComponent(member.token)}`
      }))
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/me") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const member = await getTeamMemberByToken(url.searchParams.get("token"));
    if (!member) {
      sendJson(res, 404, { error: "Invalid IC link" });
      return;
    }
    sendJson(res, 200, { id: member.id, name: member.name });
    return;
  }

  if (req.method === "POST" && pathname === "/api/location") {
    const body = await parseBody(req);
    const member = await getTeamMemberByToken(body.token);
    if (!member) {
      sendJson(res, 401, { error: "Invalid IC link" });
      return;
    }

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const accuracy = Number(body.accuracy || 0);
    if (!isValidCoordinate(lat, lng)) {
      sendJson(res, 400, { error: "Invalid GPS coordinates" });
      return;
    }

    const now = new Date().toISOString();
    const record = {
      id: member.id,
      name: member.name,
      lat,
      lng,
      accuracy: Number.isFinite(accuracy) ? accuracy : 0,
      note: String(body.note || "").slice(0, 120),
      updatedAt: now
    };
    const locations = await readStore("locations", { latest: {}, history: [] });
    locations.latest[member.id] = record;
    locations.history.unshift(record);
    locations.history = locations.history.slice(0, 500);
    await writeStore("locations", locations);
    sendJson(res, 200, { ok: true, location: record });
    return;
  }

  if (req.method === "GET" && pathname === "/api/locations") {
    if (!(await isAdmin(req))) {
      sendJson(res, 401, { error: "Admin login required" });
      return;
    }
    const team = await readStore("team", []);
    const locations = await readStore("locations", { latest: {}, history: [] });
    sendJson(res, 200, {
      people: team.map(member => ({
        id: member.id,
        name: member.name,
        location: locations.latest[member.id] || null
      })),
      history: locations.history.slice(0, 50)
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/admin.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

async function main() {
  await ensureDataFiles();
  const server = http.createServer(requestHandler);

  server.listen(PORT, () => {
    console.log(`Team location dashboard running at http://localhost:${PORT}`);
    console.log(`Admin password: ${ADMIN_PASSWORD === "change-me" ? "change-me (set ADMIN_PASSWORD before real use)" : "(set from environment)"}`);
    console.log(`Storage: ${HAS_REDIS ? "Upstash Redis" : "local JSON"}`);
  });
}

if (require.main === module) {
  main();
}

module.exports = async function vercelHandler(req, res) {
  await ensureDataFiles();
  await requestHandler(req, res);
};
