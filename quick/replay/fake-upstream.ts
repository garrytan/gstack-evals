// A fake upstream for keyless tests: Anthropic Messages, OpenRouter chat completions and
// OpenAI Responses, with usage fields shaped like the real ones.
// A prompt containing FAKE_500_ONCE fails once with a 500, then succeeds; FAKE_SLOW answers
// after 300 ms; FAKE_200_ERROR answers 200 with an error body, as OpenRouter does when a model
// fails mid-output; FAKE_400 answers 400.
export function startFake() {
  const seen = new Set<string>();
  const calls: { route: string; body: any }[] = [];
  const review = (prompt: string) => {
    const m = /diff --git a\/(\S+) b\//.exec(prompt);
    return m ? JSON.stringify({ severity: 'CRITICAL', confidence: 8, path: m[1], line: 3, summary: 'fake finding in ' + m[1], specialist: 'fake' }) : 'NO FINDINGS';
  };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body: any = await req.json();
      calls.push({ route: url.pathname, body });
      const text = url.pathname === '/v1/messages' ? body.messages[0].content[0].text : url.pathname === '/api/v1/chat/completions' ? body.messages[0].content : body.input;
      if (text.includes('FAKE_SLOW')) await Bun.sleep(300);
      if (text.includes('FAKE_200_ERROR')) return Response.json({ error: { message: 'model failed mid-output', code: 502 } });
      if (text.includes('FAKE_400')) return Response.json({ error: { message: 'bad request' } }, { status: 400 });
      if (text.includes('FAKE_500_ONCE') && !seen.has(text)) { seen.add(text); return Response.json({ error: { message: 'overloaded' } }, { status: 500 }); }
      const inTok = Math.ceil(text.length / 3);
      if (url.pathname === '/v1/messages') {
        if (!req.headers.get('x-api-key')) return Response.json({ error: { message: 'no key' } }, { status: 401 });
        return Response.json({ model: body.model, content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: review(text) }], usage: { input_tokens: inTok, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, stop_reason: 'end_turn' });
      }
      if (url.pathname === '/api/v1/chat/completions') {
        return Response.json({ model: body.model, provider: 'DeepSeek', choices: [{ message: { content: review(text) }, finish_reason: 'stop' }], usage: { prompt_tokens: inTok, completion_tokens: 100, cost: 0.0001 } });
      }
      if (url.pathname === '/v1/responses') {
        const ids = [...text.matchAll(/\{"id":"([0-9a-f]+)"/g)].map(m => m[1]);
        return Response.json({ model: body.model, status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ verdicts: ids.map(id => ({ id, names_defect: true, reason: 'fake' })) }) }] }], usage: { input_tokens: inTok, output_tokens: 50 } });
      }
      return new Response('not found', { status: 404 });
    },
  });
  const base = 'http://127.0.0.1:' + server.port;
  return { server, calls, env: { ANTHROPIC_BASE_URL: base, OPENROUTER_BASE_URL: base, OPENAI_BASE_URL: base, ANTHROPIC_API_KEY: 'fake', OPENROUTER_API_KEY: 'fake', OPENAI_API_KEY: 'fake' } };
}
