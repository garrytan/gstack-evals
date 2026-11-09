# Copyright (c) 2026 Garry Tan. MIT License.
"""A keyless stand-in for the metering proxy's provider routes, for tests against the real pinned SDKs.

It serves the proxy's URL layout on one port:
  POST /anthropic/v1/messages          Anthropic Messages
  POST /openai/v1/chat/completions     OpenAI Chat Completions
  POST /openrouter/v1/chat/completions OpenRouter chat (OpenAI shape)
  POST /typesafe/v1/systemone          TypeSafe System One
Every route checks the bearer (Authorization: Bearer or x-api-key) against --token and answers 401 otherwise.

Replies come from a per-provider script queue. Each entry is one of:
  {"kind": "text", "text": str}
  {"kind": "tool_calls", "text": str?, "calls": [{"name": str, "arguments": {...}}]}
  {"kind": "json", "value": {...}}       the assistant text is json.dumps(value)
  {"kind": "answers", "answers": {...}}  TypeSafe answers by question name, merged over the defaults
  {"kind": "stop"}                       HTTP 403 DR_ALLOWANCE_STOP; it sticks, so every later call to that
                                         provider is refused too, the way an exhausted allowance is
  {"kind": "custody"}                    HTTP 403 DR_CUSTODY_HIT (no error object, as the proxy sends it); it sticks
  {"kind": "status", "status": int}      a bare error status with a problem body, consumed once
An empty queue answers with a submit tool call for chat providers and default answers for TypeSafe.

Caching: Anthropic requests write a cache entry at each cache_control breakpoint; a later request whose leading
blocks match a written prefix reports those tokens as cache_read_input_tokens. OpenAI and OpenRouter cache every
message-boundary prefix automatically and report matches as prompt_tokens_details.cached_tokens. Tokens are
characters / 4, at least 1.

Control routes (no auth, loopback tests only):
  POST /_stub/script {"provider": str, "replies": [...]}  appends to that provider's queue
  POST /_stub/reset                                       clears queues, stops, caches and hits
  GET  /_stub/hits                                        every provider request with its usage and status

Usage: python3 stub_proxy.py --token T [--host 127.0.0.1] [--port 0] [--port-file F] [--script F]
"""

import argparse
import hashlib
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROUTES = {
    "/anthropic/v1/messages": "anthropic",
    "/openai/v1/chat/completions": "openai",
    "/openrouter/v1/chat/completions": "openrouter",
    "/typesafe/v1/systemone": "typesafe",
}
SUBMIT = "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"
STOPS = {
    "stop": ("DR_ALLOWANCE_STOP", "the session allowance cannot hold this call"),
    "custody": ("DR_CUSTODY_HIT", "the request carries 1 runner-only marker(s); custody hit, the run stops"),
}


def stop_body(kind: str) -> dict:
    """The metering proxy's problem() body; only DR_ALLOWANCE_STOP carries the error object."""
    code, reason = STOPS[kind]
    text = f"{code}: metering proxy: {reason}"
    body = {"type": f"https://github.com/garrytan/gstack-evals/blob/main/docs/errors.md#{code.lower()}", "title": code, "status": 403, "code": code, "detail": text}
    if kind == "stop":
        body["error"] = {"type": "allowance_stop", "code": code, "message": text}
    return body


def zstd_decompress(raw: bytes) -> bytes:
    """typesafe-sdk sends zstd bodies when a zstd module is importable; decode them with whichever one is."""
    for name in ("compression.zstd", "backports.zstd"):
        try:
            module = __import__(name, fromlist=["decompress"])
            return module.decompress(raw)
        except ImportError:
            continue
    import zstandard

    return zstandard.ZstdDecompressor().decompressobj().decompress(raw)


def tokens(text: str) -> int:
    return max(1, len(text) // 4) if text else 0


def canon(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def strip_cache(value):
    if isinstance(value, dict):
        return {k: strip_cache(v) for k, v in value.items() if k != "cache_control"}
    if isinstance(value, list):
        return [strip_cache(v) for v in value]
    return value


def anthropic_blocks(body: dict) -> tuple[list[str], list[int]]:
    """The request as an ordered list of canonical blocks, and the indexes that carry a cache breakpoint."""
    blocks, marks = [], []

    def add(block, marked):
        blocks.append(canon(strip_cache(block)))
        if marked:
            marks.append(len(blocks) - 1)

    for tool in body.get("tools") or []:
        add({"tool": tool}, "cache_control" in tool)
    system = body.get("system")
    if isinstance(system, str):
        add({"system": system}, False)
    for block in system or [] if isinstance(system, list) else []:
        add({"system": block}, isinstance(block, dict) and "cache_control" in block)
    for message in body.get("messages") or []:
        content = message.get("content")
        if isinstance(content, str):
            add({"role": message.get("role"), "text": content}, "cache_control" in message)
            continue
        for block in content or []:
            add({"role": message.get("role"), "block": block}, isinstance(block, dict) and "cache_control" in block)
    return blocks, marks


def anthropic_pairing_error(body: dict) -> str | None:
    """Anthropic refuses a tool_use whose result is not in the very next user message; so does the stub."""
    messages = body.get("messages") or []
    for i, message in enumerate(messages):
        content = message.get("content")
        if message.get("role") != "assistant" or not isinstance(content, list):
            continue
        ids = {b.get("id") for b in content if isinstance(b, dict) and b.get("type") == "tool_use"}
        if not ids:
            continue
        following = messages[i + 1].get("content") if i + 1 < len(messages) else None
        results = {b.get("tool_use_id") for b in following or [] if isinstance(b, dict) and b.get("type") == "tool_result"}
        if not ids <= results:
            return f"messages.{i}: tool_use ids {sorted(ids - results)} have no tool_result in the next message"
    return None


def prefix_key(blocks: list[str], n: int) -> str:
    return hashlib.sha256("\x00".join(blocks[:n]).encode()).hexdigest()


class Stub:
    def __init__(self, token: str):
        self.token = token
        self.lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        self.queues: dict[str, list[dict]] = {p: [] for p in ROUTES.values()}
        self.stopped: dict[str, dict] = {}
        self.cache: dict[str, set[str]] = {p: set() for p in ROUTES.values()}
        self.hits: list[dict] = []
        self.seq = 0

    def next_reply(self, provider: str) -> dict | None:
        if provider in self.stopped:
            return self.stopped[provider]
        queue = self.queues[provider]
        if not queue:
            return None
        reply = queue.pop(0)
        if reply.get("kind") in STOPS:
            self.stopped[provider] = reply
        return reply

    def anthropic_usage(self, body: dict, out_text: str) -> dict:
        blocks, marks = anthropic_blocks(body)
        written = self.cache["anthropic"]
        last = marks[-1] + 1 if marks else 0
        hit = max((n for n in range(1, last + 1) if prefix_key(blocks, n) in written), default=0)
        for m in marks:
            written.add(prefix_key(blocks, m + 1))
        size = lambda a, b: tokens("".join(blocks[a:b]))
        return {
            "input_tokens": size(max(hit, last), len(blocks)) or 1,
            "cache_read_input_tokens": size(0, hit),
            "cache_creation_input_tokens": size(hit, last) if last > hit else 0,
            "output_tokens": tokens(out_text) or 1,
        }

    def openai_usage(self, provider: str, body: dict, out_text: str) -> dict:
        messages = [canon(strip_cache(m)) for m in body.get("messages") or []]
        written = self.cache[provider]
        hit = max((n for n in range(1, len(messages)) if prefix_key(messages, n) in written), default=0)
        for n in range(1, len(messages) + 1):
            written.add(prefix_key(messages, n))
        prompt = tokens("".join(messages))
        cached = tokens("".join(messages[:hit])) if hit else 0
        completion = tokens(out_text) or 1
        return {
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": prompt + completion,
            "prompt_tokens_details": {"cached_tokens": min(cached, prompt)},
        }

    def anthropic_reply(self, body: dict, reply: dict | None) -> dict:
        self.seq += 1
        reply = reply or {"kind": "tool_calls", "calls": [{"name": "bash", "arguments": {"command": SUBMIT}}]}
        content = []
        text = reply.get("text") or (canon(reply["value"]) if reply.get("kind") == "json" else None)
        if text:
            content.append({"type": "text", "text": text})
        for i, call in enumerate(reply.get("calls") or []):
            content.append({"type": "tool_use", "id": f"toolu_{self.seq:04d}_{i}", "name": call["name"], "input": call["arguments"]})
        out_text = canon(content)
        return {
            "id": f"msg_stub_{self.seq:04d}",
            "type": "message",
            "role": "assistant",
            "model": body.get("model"),
            "content": content,
            "stop_reason": "tool_use" if reply.get("calls") else "end_turn",
            "stop_sequence": None,
            "usage": self.anthropic_usage(body, out_text),
        }

    def chat_reply(self, provider: str, body: dict, reply: dict | None) -> dict:
        self.seq += 1
        reply = reply or {"kind": "tool_calls", "calls": [{"name": "bash", "arguments": {"command": SUBMIT}}]}
        text = reply.get("text") or (json.dumps(reply["value"]) if reply.get("kind") == "json" else None)
        message = {"role": "assistant", "content": text}
        calls = [
            {"id": f"call_{self.seq:04d}_{i}", "type": "function", "function": {"name": c["name"], "arguments": json.dumps(c["arguments"])}}
            for i, c in enumerate(reply.get("calls") or [])
        ]
        if calls:
            message["tool_calls"] = calls
        return {
            "id": f"chatcmpl-stub-{self.seq:04d}",
            "object": "chat.completion",
            "created": 1762646400,
            "model": body.get("model"),
            "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls" if calls else "stop", "logprobs": None}],
            "usage": self.openai_usage(provider, body, canon(message)),
        }

    def typesafe_reply(self, body: dict, reply: dict | None) -> dict:
        answers = {}
        for name, question in (body.get("questions") or {}).items():
            if question.get("type") == "choice":
                options = list(question.get("criteria") or {})
                probs = {o: round(1 / len(options), 6) for o in options}
                answers[name] = {"type": "choice", "choice": options[0], "confidence": probs[options[0]], "probabilities": probs}
            else:
                answers[name] = {"type": "noul", "noul": 0.5}
        answers.update((reply or {}).get("answers") or {})
        return {"model": body.get("model"), "answers": answers, "usage": {"input_tokens": tokens(canon(body)), "output_tokens": 0}}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    stub: Stub

    def log_message(self, *args) -> None:
        pass

    def send(self, status: int, body: dict, content_type: str = "application/json") -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b""
        if raw and (self.headers.get("content-encoding") or "").lower() == "zstd":
            raw = zstd_decompress(raw)
        return json.loads(raw) if raw else {}

    def do_GET(self) -> None:
        if self.path == "/_stub/hits":
            with self.stub.lock:
                return self.send(200, {"hits": self.stub.hits})
        self.send(404, {"detail": f"no stub route GET {self.path}"})

    def do_POST(self) -> None:
        stub = self.stub
        try:
            body = self.read_json()
        except (ValueError, ImportError):
            return self.send(400, {"detail": "the body is not JSON"})
        if self.path == "/_stub/script":
            with stub.lock:
                stub.queues[body["provider"]].extend(body["replies"])
            return self.send(200, {"ok": True})
        if self.path == "/_stub/reset":
            with stub.lock:
                stub.reset()
            return self.send(200, {"ok": True})
        provider = ROUTES.get(self.path.split("?")[0])
        if provider is None:
            return self.send(404, {"detail": f"no stub route POST {self.path}"})
        header = self.headers.get("authorization") or ""
        presented = header[7:] if header.lower().startswith("bearer ") else self.headers.get("x-api-key")
        with stub.lock:
            hit = {"provider": provider, "path": self.path, "model": body.get("model"), "auth_ok": presented == stub.token, "encoding": self.headers.get("content-encoding"),
                   "max_tokens": body.get("max_tokens"), "max_completion_tokens": body.get("max_completion_tokens")}
            stub.hits.append(hit)
            if presented != stub.token:
                hit["status"] = 401
                return self.send(401, {"type": "error", "error": {"type": "authentication_error", "message": "stub: wrong bearer"}})
            if body.get("stream"):
                hit["status"] = 400
                return self.send(400, {"error": {"type": "invalid_request_error", "message": "stub: streaming is not served"}})
            pairing = anthropic_pairing_error(body) if provider == "anthropic" else None
            if pairing:
                hit["status"] = 400
                return self.send(400, {"type": "error", "error": {"type": "invalid_request_error", "message": pairing}})
            reply = stub.next_reply(provider)
            kind = (reply or {}).get("kind")
            if kind in STOPS:
                hit["status"] = 403
                return self.send(403, stop_body(kind), "application/problem+json")
            if kind == "status":
                hit["status"] = reply["status"]
                return self.send(reply["status"], {"error": {"type": "stub_error", "message": f"stub status {reply['status']}"}})
            if provider == "anthropic":
                answer = stub.anthropic_reply(body, reply)
            elif provider == "typesafe":
                answer = stub.typesafe_reply(body, reply)
            else:
                answer = stub.chat_reply(provider, body, reply)
            hit["status"] = 200
            hit["usage"] = answer["usage"]
            hit["tools"] = len(body.get("tools") or [])
            self.send(200, answer)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--port-file")
    parser.add_argument("--script", help="JSON file {provider: [replies]} loaded at start")
    args = parser.parse_args(argv)
    Handler.stub = Stub(args.token)
    if args.script:
        with open(args.script) as f:
            for provider, replies in json.load(f).items():
                Handler.stub.queues[provider].extend(replies)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    port = server.server_address[1]
    if args.port_file:
        with open(args.port_file + ".tmp", "w") as f:
            f.write(str(port))
        os.replace(args.port_file + ".tmp", args.port_file)
    print(f"stub_proxy listening on {args.host}:{port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
