// A reference build for the fixture unit: every hidden task works, with data saved to data.json beside it.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const FILE = path.join(__dirname, "data.json");
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; } };
const save = (plants) => fs.writeFileSync(FILE, JSON.stringify(plants));
const DAY = 86400000;
const due = (p) => p.watered === null || Date.now() - p.watered >= p.days * DAY;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const body = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });
function page(plants) {
  const rows = plants.map((p) => "<li><span>" + esc(p.name) + ", every " + p.days + " days, " + (due(p) ? "Due today" : "Watered, next in " + p.days + " days") + "</span> " +
    "<form method=post action=/water style=display:inline><input type=hidden name=name value=\"" + esc(p.name) + "\"><button id=\"water-" + esc(p.name) + "\">Watered</button></form> " +
    "<form method=post action=/remove style=display:inline><input type=hidden name=name value=\"" + esc(p.name) + "\"><button id=\"remove-" + esc(p.name) + "\">Remove</button></form></li>").join("");
  return "<!doctype html><title>Plants</title><h1>Plants</h1>" +
    "<form method=post action=/add><label>Name <input id=name name=name></label> <label>Every how many days <input id=days name=days type=number min=1></label> <button id=add>Add plant</button></form>" +
    "<p><label>Import a CSV (name,days) <input id=import-file type=file accept=.csv></label> <button id=import onclick=\"importCsv()\">Import</button></p>" +
    "<ul id=plants>" + rows + "</ul>" +
    "<script>async function importCsv(){const f=document.getElementById('import-file').files[0];if(!f)return;await fetch('/import',{method:'POST',body:await f.text()});location.reload();}</script>";
}
http.createServer(async (req, res) => {
  const plants = load();
  if (req.method === "POST") {
    const raw = await body(req);
    const f = new URLSearchParams(raw);
    if (req.url === "/add" && f.get("name") && Number(f.get("days")) > 0 && !plants.some((p) => p.name === f.get("name"))) plants.push({ name: f.get("name"), days: Number(f.get("days")), watered: null });
    if (req.url === "/water") for (const p of plants) if (p.name === f.get("name")) p.watered = Date.now();
    if (req.url === "/import") for (const line of raw.split(/\r?\n/).slice(1)) { const [name, days] = line.split(","); if (name && Number(days) > 0 && !plants.some((p) => p.name === name.trim())) plants.push({ name: name.trim(), days: Number(days), watered: null }); }
    const kept = req.url === "/remove" ? plants.filter((p) => p.name !== f.get("name")) : plants;
    save(kept);
    res.writeHead(303, { location: "/" });
    return res.end();
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page(plants));
}).listen(Number(process.env.PORT || 3000), "0.0.0.0");
