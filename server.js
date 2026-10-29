
const express = require("express");
const helmet = require("helmet");
const cookieSession = require("cookie-session");
const { rateLimit } = require("express-rate-limit");
const crypto = require("node:crypto");

const app = express();
const production = process.env.NODE_ENV === "production";

const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
const OWNER_PIN = process.env.OWNER_PIN;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!OWNER_PASSWORD || OWNER_PASSWORD.length < 16) {
  throw new Error("OWNER_PASSWORD must be at least 16 characters.");
}
if (!OWNER_PIN || OWNER_PIN.length < 8) {
  throw new Error("OWNER_PIN must be at least 8 characters.");
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters.");
}

const COLORS = [
  { name: "Blue", hex: "#3B82F6", emoji: "🔵" },
  { name: "Green", hex: "#22C55E", emoji: "🟢" },
  { name: "Yellow", hex: "#FACC15", emoji: "🟡" },
  { name: "Purple", hex: "#A855F7", emoji: "🟣" },
  { name: "Orange", hex: "#F97316", emoji: "🟠" },
  { name: "Red", hex: "#EF4444", emoji: "🔴" }
];

const players = new Map();

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "10kb" }));

app.use(cookieSession({
  name: "my_color_dice",
  keys: [SESSION_SECRET],
  httpOnly: true,
  secure: production,
  sameSite: "strict",
  maxAge: 2 * 60 * 60 * 1000
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false
});

function ownerOnly(req, res, next) {
  if (req.session?.owner === true) return next();
  return res.status(401).json({ error: "Owner login required." });
}

function getPlayer(req) {
  const id = req.session?.playerId;
  return id ? players.get(id) || null : null;
}

function noCache(res) {
  res.set("Cache-Control", "no-store");
}

const page = String.raw\`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>My Color Dice</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:20px;font-family:system-ui,sans-serif;color:white;background:radial-gradient(ellipse at top,#29205b,#101025 70%);min-height:100vh}
main{max-width:760px;margin:auto}
header{text-align:center;padding:20px}
h1{font-size:clamp(2.5rem,8vw,4rem);background:linear-gradient(90deg,#60a5fa,#a78bfa,#fb923c);color:transparent;background-clip:text}
.panel{background:#ffffff0d;border:1px solid #ffffff24;border-radius:22px;padding:22px;margin:16px 0}
button,input,select{font:inherit;padding:12px;border-radius:10px}
button{cursor:pointer;background:#a78bfa;color:#17122d;font-weight:bold}
input,select{width:100%;margin:6px 0 12px;background:#18172e;color:white}
#die{width:170px;height:170px;margin:20px auto;border:6px solid #ffffffaa;border-radius:30px;display:grid;place-items:center;font-size:5rem;background:#3B82F6}
.center{text-align:center}
.colors{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.swatch{padding:12px 4px;border-radius:10px;text-align:center;font-weight:bold}
.hidden{display:none}
.notice{padding:12px;background:#facc1520;border-radius:10px}
</style>
</head>
<body><main>
<header><h1>🌈 My Color Dice</h1><p>Your colors. Your roll. Your game.</p></header>
<section class="panel" id="join">
<h2>Join the game</h2>
<input id="nickname" maxlength="24" placeholder="Your nickname">
<button id="joinBtn">Join game</button>
</section>
<section class="panel hidden" id="game">
<div class="center"><p id="playerName"></p><div id="die">🎲</div><h3 id="result">Ready to roll?</h3><p id="notice" class="notice">Fair random mode.</p>
<button id="rollBtn">🎲 Roll Dice</button>
<button id="newBtn">New game</button></div>
<h3>Available colors</h3><div id="colors" class="colors"></div>
</section>
<section class="panel">
<h2>🔐 Private owner panel</h2>
<form id="login">
<label>Owner password</label><input id="password" type="password" required>
<label>Verification PIN</label><input id="pin" type="password" required>
<button>Owner login</button>
</form>
<div id="owner" class="hidden">
<button id="refresh">Refresh players</button>
<button id="logout">Log out</button>
<label>Select player</label><select id="players"></select>
<h3>Disable or restore colors</h3><div id="ownerColors" class="colors"></div>
<label>Controlled test result</label><select id="forced"></select>
<button id="save">Save settings</button>
<p id="ownerMessage"></p>
</div><p id="loginMessage"></p>
</section>
<footer>Testing results and disabled colors are disclosed to players.</footer>
</main>
<script>
const $=id=>document.getElementById(id);
let colors=[],player=null,players=[],disabled=new Set(),forced=null;
async function api(url,options={}){
 const r=await fetch(url,{credentials:"same-origin",...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
 const d=await r.json();if(!r.ok)throw Error(d.error||"Request failed");return d;
}
function render(){
 $("colors").replaceChildren();$("ownerColors").replaceChildren();$("forced").replaceChildren();
 const fair=document.createElement("option");fair.value="";fair.textContent="Fair random";$("forced").append(fair);
 colors.forEach((c,i)=>{
  const s=document.createElement("div");s.className="swatch";
  s.style.background=c.hex;s.style.color=c.name==="Yellow"?"#241d00":"white";
  s.textContent=(player?.disabledColors.includes(i)?"Disabled: ":"")+c.emoji+" "+c.name;
  $("colors").append(s);
  const b=document.createElement("button");b.className="swatch";b.type="button";
  b.style.background=c.hex;b.style.color=c.name==="Yellow"?"#241d00":"white";
  b.textContent=(disabled.has(i)?"Restore ":"Disable ")+c.name;
  b.onclick=()=>{disabled.has(i)?disabled.delete(i):disabled.add(i);render();};
  $("ownerColors").append(b);
  const o=document.createElement("option");o.value=i;o.textContent=c.name;$("forced").append(o);
 });
 $("forced").value=forced===null?"":String(forced);
}
async function refreshState(){
 const s=await api("/api/state");colors=s.colors;player=s.player;
 $("join").classList.toggle("hidden",!!player);$("game").classList.toggle("hidden",!player);
 if(player){$("playerName").textContent="Playing as "+player.name;$("notice").textContent=s.notice;}
 render();
}
async function refreshPlayers(){
 const d=await api("/api/owner/players");players=d.players;
 $("players").replaceChildren();
 players.forEach(p=>{const o=document.createElement("option");o.value=p.id;o.textContent=p.name;$("players").append(o);});
 loadPlayer();
}
function loadPlayer(){
 const p=players.find(p=>p.id===$("players").value);
 disabled=new Set(p?.disabledColors||[]);forced=p?.forcedColor??null;
 $("ownerMessage").textContent=p?"Selected: "+p.name:"No active players yet.";
 render();
}
$("joinBtn").onclick=async()=>{
 try{await api("/api/join",{method:"POST",body:JSON.stringify({name:$("nickname").value})});await refreshState();}
 catch(e){alert(e.message);}
};
$("rollBtn").onclick=async()=>{
 try{
 const d=await api("/api/roll",{method:"POST",body:"{}"});
 $("die").style.background=d.color.hex;$("die").textContent=d.color.emoji;
 $("result").textContent=d.color.name+" "+d.color.hex;$("notice").textContent=d.notice;
 await refreshState();
 }catch(e){$("result").textContent=e.message;}
};
$("newBtn").onclick=async()=>{
 try{await api("/api/new-game",{method:"POST",body:"{}"});await refreshState();$("result").textContent="New game. Colors restored.";}
 catch(e){$("result").textContent=e.message;}
};
$("login").onsubmit=async e=>{
 e.preventDefault();
 try{
 await api("/api/login",{method:"POST",body:JSON.stringify({password:$("password").value,pin:$("pin").value})});
 $("password").value="";$("pin").value="";$("login").classList.add("hidden");$("owner").classList.remove("hidden");
 await refreshPlayers();$("loginMessage").textContent="Owner verified.";
 }catch(err){$("loginMessage").textContent=err.message;}
};
$("refresh").onclick=()=>refreshPlayers().catch(e=>$("ownerMessage").textContent=e.message);
$("players").onchange=loadPlayer;
$("forced").onchange=()=>{forced=$("forced").value===""?null:Number($("forced").value);};
$("save").onclick=async()=>{
 const id=$("players").value;if(!id)return;
 try{
 await api("/api/owner/players/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({disabledColors:[...disabled],forcedColor:$("forced").value===""?null:Number($("forced").value)})});
 $("ownerMessage").textContent="Saved.";await refreshPlayers();
 }catch(e){$("ownerMessage").textContent=e.message;}
};
$("logout").onclick=async()=>{
 try{await api("/api/logout",{method:"POST",body:"{}"});$("owner").classList.add("hidden");$("login").classList.remove("hidden");}
 catch(e){$("ownerMessage").textContent=e.message;}
};
async function boot(){
 colors=(await api("/api/state")).colors;
 const me=await api("/api/me");
 if(me.playerId)await refreshState();else render();
 if(me.owner){$("login").classList.add("hidden");$("owner").classList.remove("hidden");await refreshPlayers();}
}
boot().catch(e=>{$("result").textContent=e.message;});
</script></body></html>\`;

const cryptoSafeEqual = (a,b) => {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x,y);
};

app.get("/api/me",(req,res)=>{
 noCache(res);res.json({owner:req.session?.owner===true,playerId:req.session?.playerId||null});
});
app.post("/api/join",(req,res)=>{
 let p=getPlayer(req);
 if(!p){p={id:crypto.randomUUID(),name:String(req.body?.name||"Player").replace(/[<>]/g,"").slice(0,24),disabledColors:[],forcedColor:null,lastSeen:Date.now()};players.set(p.id,p);}
 req.session={...(req.session||{}),playerId:p.id};noCache(res);res.json({player:p});
});
app.get("/api/state",(req,res)=>{
 const p=getPlayer(req);
 res.json({colors:COLORS,player:p,notice:!p?"Join the game":p.forcedColor!==null?"Testing mode: owner-selected outcome":p.disabledColors.length?"Some colors are disabled":"Fair random mode"});
});
app.post("/api/login",loginLimiter,(req,res)=>{
 const pw=typeof req.body?.password==="string"?req.body.password:"";
 const pin=typeof req.body?.pin==="string"?req.body.pin:"";
 if(!cryptoSafeEqual(pw,OWNER_PASSWORD)||!cryptoSafeEqual(pin,OWNER_PIN))return res.status(401).json({error:"Incorrect password or PIN"});
 req.session={...(req.session||{}),owner:true};noCache(res);res.json({ok:true});
});
app.post("/api/logout",ownerOnly,(req,res)=>{const id=req.session?.playerId;req.session=id?{playerId:id}:null;res.json({ok:true});});
app.get("/api/owner/players",ownerOnly,(req,res)=>{
 const list=[...players.values()].filter(p=>Date.now()-p.lastSeen<1800000);
 res.json({players:list});
});
app.put("/api/owner/players/:id",ownerOnly,(req,res)=>{
 const p=players.get(req.params.id);if(!p)return res.status(404).json({error:"Player not found"});
 const {disabledColors,forcedColor}=req.body||{};
 if(!Array.isArray(disabledColors)||!disabledColors.every(i=>Number.isInteger(i)&&i>=0&&i<COLORS.length)||new Set(disabledColors).size>=COLORS.length)return res.status(400).json({error:"Invalid disabled colors"});
 if(forcedColor!==null&&(!Number.isInteger(forcedColor)||forcedColor<0||forcedColor>=COLORS.length||disabledColors.includes(forcedColor)))return res.status(400).json({error:"Invalid test color"});
 p.disabledColors=[...new Set(disabledColors)];p.forcedColor=forcedColor;noCache(res);res.json({player:p});
});
app.post("/api/roll",(req,res)=>{
 const p=getPlayer(req);if(!p)return res.status(400).json({error:"Join first"});
 p.lastSeen=Date.now();
 if(p.forcedColor!==null)return res.json({color:COLORS[p.forcedColor],controlled:true,notice:"Owner-selected testing outcome"});
 const available=COLORS.filter((_,i)=>!p.disabledColors.includes(i));
 if(!available.length)return res.status(400).json({error:"No colors available"});
 res.json({color:available[crypto.randomInt(0,available.length)],controlled:false,notice:"Random among available colors"});
});
app.post("/api/new-game",(req,res)=>{
 const p=getPlayer(req);if(!p)return res.status(400).json({error:"Join first"});
 p.disabledColors=[];p.forcedColor=null;res.json({ok:true});
});
app.get("/",(req,res)=>{noCache(res);res.type("html").send(page);});
app.listen(Number(process.env.PORT||3000),"0.0.0.0",()=>console.log("My Color Dice running"));
