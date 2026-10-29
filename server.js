
const express = require("express");
const helmet = require("helmet");
const cookieSession = require("cookie-session");
const { rateLimit } = require("express-rate-limit");
const crypto = require("node:crypto");

const app = express();
const production = process.env.NODE_ENV === "production";
const ownerPassword = process.env.OWNER_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;

if (!ownerPassword || ownerPassword.length < 16) {
  throw new Error("Set OWNER_PASSWORD to a strong password of at least 16 characters.");
}
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("Set SESSION_SECRET to a random secret of at least 32 characters.");
}

const colors = [
  { name: "Blue", hex: "#3B82F6", emoji: "🔵" },
  { name: "Green", hex: "#22C55E", emoji: "🟢" },
  { name: "Yellow", hex: "#FACC15", emoji: "🟡" },
  { name: "Purple", hex: "#A855F7", emoji: "🟣" },
  { name: "Orange", hex: "#F97316", emoji: "🟠" },
  { name: "Red", hex: "#EF4444", emoji: "🔴" }
];

// Settings are server-side. For persistence across restarts,
// replace this object with a database.
const settings = { mode: "fair", testIndex: 0 };

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "10kb" }));
app.use(cookieSession({
  name: "dice_owner",
  keys: [sessionSecret],
  httpOnly: true,
  secure: production,
  sameSite: "strict",
  maxAge: 2 * 60 * 60 * 1000
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

function ownerOnly(req, res, next) {
  if (req.session && req.session.owner === true) return next();
  return res.status(401).json({ error: "Owner login required." });
}

app.get("/api/state", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    colors,
    mode: settings.mode,
    testing: settings.mode === "testing"
  });
});

app.get("/api/me", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ owner: req.session?.owner === true });
});

app.post("/api/login", loginLimiter, (req, res) => {
  const supplied = typeof req.body?.password === "string"
    ? req.body.password
    : "";

  // Compare fixed-length hashes to avoid a length-based comparison.
  const expected = crypto.createHash("sha256").update(ownerPassword).digest();
  const actual = crypto.createHash("sha256").update(supplied).digest();

  if (!crypto.timingSafeEqual(expected, actual)) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  req.session = { owner: true };
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});

app.post("/api/logout", ownerOnly, (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.post("/api/settings", ownerOnly, (req, res) => {
  const { mode, testIndex } = req.body || {};

  if (!["fair", "testing"].includes(mode)) {
    return res.status(400).json({ error: "Invalid mode." });
  }

  if (
    !Number.isInteger(testIndex) ||
    testIndex < 0 ||
    testIndex >= colors.length
  ) {
    return res.status(400).json({ error: "Invalid test color." });
  }

  settings.mode = mode;
  settings.testIndex = testIndex;

  res.json({ ok: true, mode, testIndex });
});

app.post("/api/roll", (req, res) => {
  // The server, not the browser, decides the outcome.
  const index = settings.mode === "testing"
    ? settings.testIndex
    : crypto.randomInt(0, colors.length);

  res.set("Cache-Control", "no-store");
  res.json({
    color: colors[index],
    testing: settings.mode === "testing"
  });
});

const page = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#101025">
<title>My Color Dice</title>
<style>
:root{font-family:system-ui,sans-serif;color:#fff;background:#101025}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top,#29205b,#101025 65%);padding:24px}
main{max-width:760px;margin:auto}
header{text-align:center;padding:20px 0}
h1{font-size:clamp(2.2rem,7vw,4rem);margin:0;background:linear-gradient(90deg,#60a5fa,#a78bfa,#fb923c);color:transparent;background-clip:text}
p{color:#c6c4de}
.panel{background:#ffffff0d;border:1px solid #ffffff24;border-radius:24px;padding:24px;margin:18px 0;box-shadow:0 16px 60px #0002}
#die{width:190px;height:190px;margin:22px auto;border:7px solid #ffffffaa;border-radius:36px;display:grid;place-items:center;font-size:6rem;background:#3B82F6;box-shadow:0 12px 45px #0006;transition:background .25s,transform .25s}
#die.rolling{animation:bounce .18s infinite alternate}
@keyframes bounce{to{transform:rotate(8deg) scale(.96)}}
button,input,select{font:inherit;border-radius:12px;padding:12px 15px;border:1px solid #ffffff38}
button{cursor:pointer;font-weight:750;background:#a78bfa;color:#17122d}
button:disabled{opacity:.6;cursor:wait}
input,select{background:#18172e;color:white;width:100%;margin:6px 0 12px}
.actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}
#roll{font-size:1.2rem;padding:14px 28px;background:linear-gradient(90deg,#60a5fa,#a78bfa,#fb923c)}
.result{text-align:center;font-size:1.2rem;font-weight:750;min-height:32px}
.notice{padding:12px;border-radius:12px;background:#facc1520;color:#fde68a}
.hidden{display:none!important}
.colors{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.swatch{padding:10px 4px;border-radius:12px;text-align:center;font-size:.9rem;font-weight:700}
label{display:block;margin-top:12px;font-weight:650}
footer{text-align:center;color:#aaa6c9;font-size:.85rem;padding:20px}
</style>
</head>
<body><main>
<header><h1>🌈 My Color Dice</h1><p>Your colors. Your roll. Your game.</p></header>
<section class="panel" aria-label="Dice roller">
<div id="status" class="result" aria-live="polite">Ready to roll?</div>
<div id="die" aria-label="Dice result">🎲</div>
<div id="result" class="result" aria-live="polite">Choose Roll Dice to begin</div>
<div id="modeNotice" class="notice hidden">Testing mode is active. Results are owner-controlled, not random.</div>
<div class="actions"><button id="roll">🎲 Roll Dice</button></div>
</section>
<section class="panel"><h2>Six rainbow colors</h2><div id="colors" class="colors"></div></section>
<section class="panel">
<h2>🔐 Owner dashboard</h2>
<p>Only the owner can change the dice mode and test result.</p>
<form id="loginForm">
<label for="password">Owner password</label>
<input id="password" type="password" autocomplete="current-password" required minlength="1" placeholder="Enter your owner password">
<button type="submit">Owner login</button>
</form>
<div id="ownerPanel" class="hidden">
<p>You're logged in as the owner.</p>
<label for="mode">Dice mode</label>
<select id="mode"><option value="fair">Fair random dice</option><option value="testing">Testing mode (controlled result)</option></select>
<label for="testColor">Test outcome</label>
<select id="testColor"></select>
<div class="actions"><button id="save" type="button">Save settings</button><button id="logout" type="button">Log out</button></div>
<p id="ownerMessage" aria-live="polite"></p>
</div>
<p id="loginMessage" aria-live="polite"></p>
</section>
<footer>My Color Dice · Testing mode is clearly identified.</footer>
</main>
<script>
const $ = id => document.getElementById(id);
let busy = false;
let colors = [];

async function api(url, options={}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function renderColors() {
  $("colors").innerHTML = "";
  $("testColor").innerHTML = "";
  colors.forEach((c,i) => {
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = c.hex;
    swatch.style.color = c.name === "Yellow" ? "#241d00" : "#fff";
    swatch.textContent = c.emoji + " " + c.name;
    $("colors").append(swatch);
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = c.name;
    $("testColor").append(option);
  });
}
async function refresh() {
  const state = await api("/api/state");
  colors = state.colors;
  renderColors();
  $("modeNotice").classList.toggle("hidden", !state.testing);
  $("status").textContent = state.testing ? "Testing mode" : "Fair random mode";
  const me = await api("/api/me");
  $("ownerPanel").classList.toggle("hidden", !me.owner);
  $("loginForm").classList.toggle("hidden", me.owner);
  if (me.owner) $("mode").value = state.mode;
}
$("roll").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  $("roll").disabled = true;
  $("die").classList.add("rolling");
  $("result").textContent = "Rolling...";
  try {
    // Brief animation; actual outcome comes from the server.
    await new Promise(resolve => setTimeout(resolve, 450));
    const data = await api("/api/roll", { method: "POST", body: "{}" });
    $("die").style.background = data.color.hex;
    $("die").textContent = data.color.emoji;
    $("result").textContent = data.color.name + " " + data.color.hex;
    $("modeNotice").classList.toggle("hidden", !data.testing);
    $("status").textContent = data.testing ? "Testing mode" : "Fair random mode";
  } catch (e) {
    $("result").textContent = e.message;
  } finally {
    $("die").classList.remove("rolling");
    $("roll").disabled = false;
    busy = false;
  }
});
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("loginMessage").textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({password: $("password").value})
    });
    $("password").value = "";
    $("loginMessage").textContent = "Owner login successful.";
    await refresh();
  } catch (err) {
    $("loginMessage").textContent = err.message;
  }
});
$("save").addEventListener("click", async () => {
  try {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        mode: $("mode").value,
        testIndex: Number($("testColor").value)
      })
    });
    $("ownerMessage").textContent = "Settings saved.";
    await refresh();
  } catch (e) {
    $("ownerMessage").textContent = e.message;
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", {method:"POST",body:"{}"});
    $("ownerMessage").textContent = "Logged out.";
    await refresh();
  } catch(e) {
    $("ownerMessage").textContent = e.message;
  }
});
refresh().catch(e => $("result").textContent = "Could not connect to server: " + e.message);
</script>
</body></html>`;

app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.type("html").send(page);
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`My Color Dice is running on port ${port}`);
});
