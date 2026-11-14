// Copyright (c) 2026 Garry Tan. MIT License.
// The VM proxy endpoint on the controller host (the wiring file's vm.proxy): the one address a recipe or build VM's
// egress filter accepts for model calls. Each session item (dc-base-apps, dc-stage3-authoring, dc-stage3-builds) has
// its own metering proxy on the host's loopback (paid/sessions.ts), so this front forwards each request by its first
// path segment, the session's slot, to the proxy that bound it, streaming both ways and unchanged otherwise. An unbound
// slot gets 404 and reaches no proxy; the proxy still checks the slot's bearer.
import { DcError } from "../errors.ts";

export interface VmFront {
  /** The base URL VMs reach, before the slot. */
  url: string;
  route(slot: string, upstream: string): void;
  unroute(slot: string): void;
  close(): void;
}

const HOP = ["host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"];

/** Serves the front on host:port; upstream is a proxy's base URL before the slot. */
export function serveVmFront(o: { host: string; port: number; fetch?: typeof fetch }): VmFront {
  const routes = new Map<string, string>();
  const send = o.fetch ?? globalThis.fetch.bind(globalThis);
  const server = Bun.serve({
    hostname: o.host,
    port: o.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const slot = url.pathname.split("/")[1] ?? "";
      const up = routes.get(slot);
      if (!up) return new Response("no such slot\n", { status: 404 });
      const headers = new Headers(req.headers);
      for (const h of HOP) headers.delete(h);
      try {
        return await send(up.replace(/\/+$/, "") + url.pathname + url.search, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body, redirect: "manual", decompress: false, duplex: "half" } as RequestInit);
      } catch {
        return new Response("the slot's proxy did not answer\n", { status: 502 });
      }
    },
  });
  return {
    url: "http://" + o.host + ":" + server.port,
    route(slot, upstream) {
      if (!/^[A-Za-z0-9_-]+$/.test(slot)) throw new DcError("E_INTERNAL", "slot " + JSON.stringify(slot) + " is not a path segment");
      routes.set(slot, upstream);
    },
    unroute(slot) {
      routes.delete(slot);
    },
    close() {
      server.stop(true);
    },
  };
}
