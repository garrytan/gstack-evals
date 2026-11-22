// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's model tap for Sol sessions (the second attempt's pre-run change 2). Codex's exec events
// and rollout carry the model a session asked for, never the one each response reports, and the metering proxy does not
// record that field. So each Sol session reaches the proxy through this tap: a container of its own on the trial
// network (run/codex-rig.ts), out of the agent's reach, that passes every request and response through unchanged and
// appends, for each response, the slot, status and every response id with the model it reports to a log under the run
// dir. run.ts reads a session's lines by its slot and halts on any model that is not the pin (pinned.ts reportsPin).
// It runs standalone (bun tap.ts <config.json>) and imports nothing from the repository.
import { appendFileSync, readFileSync } from "node:fs";

/** Each response id and the model it reports, from a Responses SSE stream or a JSON body; the last report per id wins. */
export function reportedModels(text: string): { id: string | null; model: string | null }[] {
  const seen = new Map<string | null, string | null>();
  const take = (r: any) => {
    if (r && typeof r === "object" && ("model" in r || "id" in r)) seen.set(typeof r.id === "string" ? r.id : null, typeof r.model === "string" ? r.model : null);
  };
  const t = text.trimStart();
  if (t.startsWith("{")) {
    try {
      take(JSON.parse(t));
    } catch {}
  } else
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j?.response) take(j.response);
      } catch {}
    }
  return [...seen].map(([id, model]) => ({ id, model }));
}

if (import.meta.main) {
  const cfg = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { upstream: string; port: number; log: string };
  Bun.serve({
    hostname: "0.0.0.0",
    port: cfg.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const headers = new Headers(req.headers);
      headers.delete("host");
      const res = await fetch(cfg.upstream.replace(/\/+$/, "") + url.pathname + url.search, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(), redirect: "manual" });
      const out = new Headers(res.headers);
      for (const h of ["content-encoding", "content-length", "transfer-encoding"]) out.delete(h);
      const line = (models: { id: string | null; model: string | null }[]) => appendFileSync(cfg.log, JSON.stringify({ at: new Date().toISOString(), slot: url.pathname.split("/")[1] ?? "", path: url.pathname, status: res.status, responses: models }) + "\n");
      if (!res.body) {
        line([]);
        return new Response(null, { status: res.status, headers: out });
      }
      const [client, kept] = res.body.tee();
      void new Response(kept).text().then((t) => line(reportedModels(t)), () => line([]));
      return new Response(client, { status: res.status, headers: out });
    },
  });
  console.log("TAP_READY " + cfg.port);
}
