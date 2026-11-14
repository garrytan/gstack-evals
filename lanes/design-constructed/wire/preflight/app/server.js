// Copyright (c) 2026 Garry Tan. MIT License.
// The preflight's fixture app (lanes/design-constructed/wire/preflight.ts): three pages on 127.0.0.1:3000. The root
// answers 200 only when the recipe's Redis service answers PING on 127.0.0.1:6379, so one page load in the VM's browser
// checks the app, its one dependency from the npm mirror and the service docker run started from the dockerhub mirror.
const http = require("node:http");
const net = require("node:net");
const escapeHtml = require("escape-html");

const ping = () =>
  new Promise((resolve) => {
    const s = net.connect(6379, "127.0.0.1");
    let got = "";
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(2000, () => done(false));
    s.on("error", () => done(false));
    s.on("connect", () => s.write("PING\r\n"));
    s.on("data", (d) => {
      got += d;
      if (got.includes("\r\n")) done(got.startsWith("+PONG"));
    });
  });

const page = (title, text) => "<!doctype html><html><head><title>" + escapeHtml(title) + '</title></head><body><div id="root"><h1>' + escapeHtml(title) + "</h1><p>" + escapeHtml(text) + "</p></div></body></html>";

http
  .createServer(async (req, res) => {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    const send = (status, title, text) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(page(title, text));
    };
    if (path === "/") return (await ping()) ? send(200, "Preflight", "The app and its Redis service answer.") : send(503, "Preflight", "The Redis service did not answer PING.");
    if (path === "/about") return send(200, "About", "A fixture app for the sandbox preflight.");
    if (path === "/health") return send(200, "Health", "ok");
    send(404, "Not found", path);
  })
  .listen(Number(process.env.PORT || 3000), "127.0.0.1");
