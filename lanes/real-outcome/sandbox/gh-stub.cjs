// gh in the trial container: a thin client of the evaluator-owned sidecar. It holds no state. It sends the argv, the current
// branch and the text of any --body-file, -F or @file argument (read here, since the sidecar cannot see container files),
// then prints what the sidecar answers. Written for old Node versions too: no optional chaining or nullish operators.
"use strict";
var fs = require("fs");
var http = require("http");
var cp = require("child_process");
var CONFIG = "__REAL_SANDBOX_CONFIG__";
var cfg;
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
} catch (e) {
  process.stderr.write("gh: not configured in this sandbox (" + CONFIG + ")\n");
  process.exit(1);
}
var argv = process.argv.slice(2);
function git(args) {
  try {
    return cp.execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (e) {
    return null;
  }
}
var stdinText = null;
function readArg(path) {
  if (path === "-") {
    if (stdinText === null) stdinText = fs.readFileSync(0, "utf8");
    return stdinText;
  }
  return fs.readFileSync(path, "utf8");
}
function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}
var out = [];
var isApi = argv[0] === "api";
try {
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    var m = /^(--body-file|-F)(?:=(.*))?$/.exec(a);
    if (!isApi && m) {
      var file = m[2] !== undefined ? m[2] : argv[++i];
      if (file === undefined) fail("flag needs an argument: " + m[1]);
      out.push("--body=" + readArg(file));
      continue;
    }
    var f = /^(--field|-F)(?:=(.*))?$/.exec(a);
    if (isApi && f) {
      var kv = f[2] !== undefined ? f[2] : argv[++i];
      if (kv === undefined) fail("flag needs an argument: " + f[1]);
      var eq = kv.indexOf("=");
      if (eq > 0 && kv.charAt(eq + 1) === "@") kv = kv.slice(0, eq + 1) + readArg(kv.slice(eq + 2));
      out.push("--field=" + kv);
      continue;
    }
    var inp = /^--input(?:=(.*))?$/.exec(a);
    if (isApi && inp) {
      var p = inp[1] !== undefined ? inp[1] : argv[++i];
      if (p === undefined) fail("flag needs an argument: --input");
      out.push("--input=" + readArg(p));
      continue;
    }
    out.push(a);
  }
} catch (e) {
  fail("open " + (e && e.path ? e.path : "file") + ": no such file or directory");
}
var body = JSON.stringify({ argv: out, branch: git(["symbolic-ref", "--quiet", "--short", "HEAD"]) });
var url = cfg.url.replace(/\/+$/, "") + "/gh";
var req = http.request(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + cfg.token, "content-length": Buffer.byteLength(body) } }, function (res) {
  var chunks = [];
  res.on("data", function (c) {
    chunks.push(c);
  });
  res.on("end", function () {
    var text = Buffer.concat(chunks).toString("utf8");
    var r;
    try {
      r = JSON.parse(text);
    } catch (e) {
      fail("gh: " + (res.statusCode === 403 ? "this sandbox is closed" : "HTTP " + res.statusCode));
    }
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exitCode = typeof r.exit === "number" ? r.exit : 1;
  });
});
req.on("error", function () {
  fail("error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com");
});
req.end(body);
