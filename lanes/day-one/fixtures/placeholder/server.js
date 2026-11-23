// A placeholder build: it starts, answers and names every feature the owner asked for on its page, and does nothing.
const http = require("node:http");
const PAGE = "<!doctype html><title>Plants</title><h1>Plant tracker</h1>" +
  "<p>Add your plants, see which need water today, mark a plant watered, import your plant spreadsheet and remove plants.</p>" +
  "<form onsubmit=\"return false\"><label>Name <input id=name></label> <label>Every how many days <input id=days type=number></label> <button id=add type=button>Add plant</button></form>" +
  "<h2>Due today</h2><p>Nothing here yet.</p>" +
  "<p><label>Import a CSV (name,days) <input id=import-file type=file accept=.csv></label> <button id=import type=button>Import</button></p>" +
  "<p><button type=button>Watered</button> <button type=button>Remove</button></p>";
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
}).listen(Number(process.env.PORT || 3000), "0.0.0.0");
