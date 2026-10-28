#!/usr/bin/env python3
"""Fake Anthropic Messages upstream for the Harbor spike.

Plays a fixed script of tool calls to Claude Code so nothing is charged.
Every request is logged (path, model, auth header names, never values).
"""
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = os.environ.get("FAKE_UPSTREAM_LOG", "fake-upstream.jsonl")
PORT = int(os.environ.get("FAKE_UPSTREAM_PORT", "8787"))
QUESTION = "Which greeting should answer.txt contain?"

PROBE = (
    "set +e; "
    "code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' https://example.com 2>/dev/null); "
    "echo \"egress_example_com=rc$?:$code\"; "
    "code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://1.1.1.1 2>/dev/null); "
    "echo \"egress_ip_literal=rc$?:$code\"; "
    "code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' https://api.anthropic.com 2>/dev/null); "
    "echo \"egress_anthropic=rc$?:$code\"; "
    "if getent hosts example.com >/dev/null; then echo dns_example_com=resolves; else echo dns_example_com=blocked; fi; "
    "code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' \"$ANTHROPIC_BASE_URL/healthz\" 2>/dev/null); "
    "echo \"proxy_healthz=rc$?:$code\"; "
    "if [ -e /tests ]; then echo tests_visible=yes; else echo tests_visible=no; fi; "
    "if [ -e /solution ]; then echo solution_visible=yes; else echo solution_visible=no; fi; "
    "echo \"sentinel=$(grep -h -o 'SPIKE-ARM-SENTINEL-[0-9a-f]*' \"$CLAUDE_CONFIG_DIR\"/skills/spike-arm/SKILL.md 2>/dev/null | head -1)\"; "
    "c=PERSONA-CANARY-; c=${c}7f3c91d2e8; "
    "scan=$(timeout 60 grep -rIl --exclude-dir=proc --exclude-dir=sys \"$c\" / 2>/dev/null; echo \"rc=$?\"); "
    "rc=${scan##*rc=}; hits=$(printf '%s\\n' \"$scan\" | grep -v '^rc=' | head -3 | tr '\\n' ','); "
    "case $rc in 0|1) echo \"persona_canary_hits=${hits:-none}\";; *) echo \"persona_canary_hits=scan_failed_rc$rc\";; esac; "
    "echo agent_only > /app/agent_only.txt; "
    "echo whoami=$(whoami)"
)


def log(entry):
    entry["ts"] = time.time()
    with open(LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")


def tool_results(messages):
    out = {}
    for m in messages:
        if m.get("role") != "user" or not isinstance(m.get("content"), list):
            continue
        for block in m["content"]:
            if block.get("type") == "tool_result":
                content = block.get("content")
                if isinstance(content, list):
                    content = "".join(c.get("text", "") for c in content if isinstance(c, dict))
                out[block.get("tool_use_id")] = content or ""
    return out


def next_turn(body):
    results = tool_results(body.get("messages", []))
    if "toolu_spike_1" not in results:
        return [{
            "type": "tool_use", "id": "toolu_spike_1", "name": "AskUserQuestion",
            "input": {"questions": [{
                "question": QUESTION, "header": "Greeting", "multiSelect": False,
                "options": [
                    {"label": "hello", "description": "Write hello"},
                    {"label": "goodbye", "description": "Write goodbye"},
                ],
            }]},
        }]
    if "toolu_spike_2" not in results:
        return [{"type": "tool_use", "id": "toolu_spike_2", "name": "Bash",
                 "input": {"command": PROBE, "description": "Spike probes"}}]
    if "toolu_spike_3" not in results:
        answer = results["toolu_spike_1"]
        m = re.search(r'="([^"]*)"', answer)
        picked = m.group(1) if m else "UNPARSED:" + answer[:120]
        content = "answer=" + picked + "\n" + results["toolu_spike_2"].strip() + "\n"
        return [{"type": "tool_use", "id": "toolu_spike_3", "name": "Write",
                 "input": {"file_path": "/app/answer.txt", "content": content}}]
    return [{"type": "text", "text": "Done: wrote /app/answer.txt."}]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        log({"method": "GET", "path": self.path})
        if self.path.startswith("/healthz"):
            return self._json(200, {"ok": True})
        return self._json(404, {"type": "error", "error": {"type": "not_found_error", "message": self.path}})

    def do_HEAD(self):
        log({"method": "HEAD", "path": self.path})
        self.send_response(200)
        self.send_header("content-length", "0")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        tools = [t.get("name") for t in body.get("tools", []) if isinstance(t, dict)]
        entry = {
            "method": "POST", "path": self.path, "model": body.get("model"),
            "stream": body.get("stream", False),
            "auth_headers": sorted(h for h in self.headers.keys() if h.lower() in ("x-api-key", "authorization")),
            "user_agent": self.headers.get("user-agent"),
            "n_messages": len(body.get("messages", [])),
            "has_ask_user_question": "AskUserQuestion" in tools,
            "n_tools": len(tools),
        }
        if self.path.startswith("/v1/messages/count_tokens"):
            log(entry)
            return self._json(200, {"input_tokens": 10})
        if not self.path.startswith("/v1/messages"):
            log(entry)
            return self._json(404, {"type": "error", "error": {"type": "not_found_error", "message": self.path}})
        if "Bash" in tools:
            blocks = next_turn(body)
        else:
            blocks = [{"type": "text", "text": "ok"}]
        entry["reply"] = [b.get("name") or b["type"] for b in blocks]
        log(entry)
        stop = "tool_use" if any(b["type"] == "tool_use" for b in blocks) else "end_turn"
        msg = {"id": "msg_spike_%d" % int(time.time() * 1000), "type": "message", "role": "assistant",
               "model": body.get("model"), "content": [], "stop_reason": None, "stop_sequence": None,
               "usage": {"input_tokens": 10, "output_tokens": 1}}
        if not body.get("stream"):
            msg["content"] = blocks
            msg["stop_reason"] = stop
            msg["usage"]["output_tokens"] = 20
            return self._json(200, msg)
        events = [("message_start", {"type": "message_start", "message": msg})]
        for i, b in enumerate(blocks):
            if b["type"] == "text":
                events.append(("content_block_start", {"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}}))
                events.append(("content_block_delta", {"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": b["text"]}}))
            else:
                events.append(("content_block_start", {"type": "content_block_start", "index": i, "content_block": {"type": "tool_use", "id": b["id"], "name": b["name"], "input": {}}}))
                events.append(("content_block_delta", {"type": "content_block_delta", "index": i, "delta": {"type": "input_json_delta", "partial_json": json.dumps(b["input"])}}))
            events.append(("content_block_stop", {"type": "content_block_stop", "index": i}))
        events.append(("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None}, "usage": {"output_tokens": 20}}))
        events.append(("message_stop", {"type": "message_stop"}))
        data = "".join("event: %s\ndata: %s\n\n" % (n, json.dumps(e)) for n, e in events).encode()
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "0.0.0.0"
    ThreadingHTTPServer((host, PORT), Handler).serve_forever()
