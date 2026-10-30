// The judge's session (U10): one model request that declares no tools. The persona's free-form answers use the same
// request (src/usersim/persona.ts), with a smaller output cap. No host CLI runs, so the judge cannot run a
// command, read a file or open a skill: it can only answer from the prompt it is sent. The request leaves from the
// judge's own container on the trial network, which holds no skill and no copy of the agent's work, through its own
// proxy slot; the proxy writes the cell's output cap into it and meters it like any session.
import type { Provider } from "../runner/pricing/prices.ts";
import type { AgentDriver, AgentOutcome } from "../trial/trial.ts";
import type { Termination } from "../types.ts";
import { refusalIn, refusalTermination } from "./claude-code/driver.ts";

/** The route a judge model's one request takes on its provider. */
export const JUDGE_ROUTE: Record<Provider, string> = { anthropic: "/v1/messages", openai: "/v1/responses", openrouter: "/v1/chat/completions" };

/** The request body: the model and one user message, and no tools, tool choice or system prompt; with maxOutputTokens, the output cap a smaller request asks for. */
export function judgeRequest(provider: Provider, model: string, prompt: string, maxOutputTokens?: number): Record<string, unknown> {
  const messages = [{ role: "user", content: prompt }];
  const cap = maxOutputTokens === undefined ? {} : { [provider === "openai" ? "max_output_tokens" : "max_tokens"]: maxOutputTokens };
  return provider === "openai" ? { model, input: messages, store: false, ...cap } : { model, messages, ...cap };
}

/** The text of the model's answer in the provider's response shape. */
export function judgeAnswer(provider: Provider, body: any): string {
  if (provider === "anthropic") return (body?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
  if (provider === "openai") return (body?.output ?? []).filter((i: any) => i?.type === "message").flatMap((i: any) => i.content ?? []).filter((c: any) => c?.type === "output_text").map((c: any) => c.text).join("");
  return body?.choices?.[0]?.message?.content ?? "";
}

/** The script that sends the request on stdin to the slot's route and prints the status and body; the slot's base URL and bearer come from the session env names the proxy's other clients use. */
const send = (route: string): string =>
  "const r = await fetch((process.env.ANTHROPIC_BASE_URL ?? process.env.OPENAI_BASE_URL) + " + JSON.stringify(route) + ", { method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: 'Bearer ' + (process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.OPENAI_API_KEY) }, body: await Bun.stdin.text() }); process.stdout.write(JSON.stringify({ status: r.status, body: await r.text() }));";

export function judgeDriver(o: { provider: Provider; model: string; proxy: { baseUrl: string; slot: string; token: string }; maxOutputTokens?: number }): AgentDriver {
  const base = o.proxy.baseUrl.replace(/\/+$/, "") + "/" + o.proxy.slot + "/" + o.provider;
  return {
    env: o.provider === "anthropic" ? { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: o.proxy.token } : { OPENAI_BASE_URL: base, OPENAI_API_KEY: o.proxy.token },
    run: async (session, task, timeoutMs) => {
      const child = session.spawn(["bun", "-e", send(JUDGE_ROUTE[o.provider])]);
      let out = "";
      child.stdout?.on("data", (d) => (out += d));
      const closed = new Promise<boolean>((resolve) => {
        child.on("close", () => resolve(true));
        child.on("error", () => resolve(true));
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)));
      child.stdin?.end(JSON.stringify(judgeRequest(o.provider, o.model, task.prompt, o.maxOutputTokens)));
      const done = await Promise.race([closed, timedOut]);
      clearTimeout(timer);
      if (!done) child.kill("SIGKILL");
      const end = (termination: Termination, turns: string[] = []): AgentOutcome => ({ turns, termination, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: turns.length, loaded_bytes: null });
      if (!done) return end({ kind: "timeout" });
      let reply: { status: number; body: string };
      try {
        reply = JSON.parse(out);
      } catch {
        return end({ kind: "missing", code: "UPSTREAM" });
      }
      if (reply.status !== 200) {
        const refusal = refusalIn(reply.body);
        return end(refusal ? refusalTermination(refusal) : { kind: "missing", code: "UPSTREAM" });
      }
      try {
        return end({ kind: "completed" }, [judgeAnswer(o.provider, JSON.parse(reply.body))]);
      } catch {
        return end({ kind: "missing", code: "UPSTREAM" });
      }
    },
  };
}
