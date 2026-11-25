#!/usr/bin/env python3
# Copyright (c) 2026 Garry Tan. MIT License.
"""Privacy and blinding check on every outgoing file of one labelling package. Exit 1 on any blocking hit.
  python3 privacy_check.py <package-dir>
Two zones. The page's own words (guide, message, bounty, the page outside its data, and every label, prompt and choice
in the data) must name no grader, model, arm, stack, earlier answer or other labeller. The material people read (the bug,
the fix and the findings) is real code, so ordinary words such as "model" or "judge" there are listed for review, while
vendor and model names, our own names and arm names still block."""
import re, sys, os, glob, json, collections
root = sys.argv[1]
files = sorted(glob.glob(os.path.join(root, 'labeller', '*.html'))) + [os.path.join(root, f) for f in ('guide.md', 'message-to-labeller.txt', 'items.json')]
if os.path.isfile(os.path.join(root, 'bounty.json')): files.append(os.path.join(root, 'bounty.json'))
missing = [f for f in files if not os.path.isfile(f)]
if missing or len(files) < 5: print('MISSING:', missing or 'labeller pages'); sys.exit(1)
EVERYWHERE = {
 'owner name or slug': r'(?i:garry|garrytan)|\bTan\b(?! line)', 'Wintermute': r'(?i)wintermute', 'OpenClaw': r'(?i)openclaw|alphaclaw',
 'our product names': r'(?i)gbrain|gstack|\bcapy\b|founderstar', 'tailnet': r'(?i)tailscale|tailnet|\.ts\.net', 'Y Combinator': r'(?i)y ?combinator|\bYC\b',
 'model or vendor name': r'(?i)\b(claude|sonnet|opus|haiku|fable|anthropic|openai|gpt-?\d[\w.]*|gpt|chatgpt|gemini|carbon|astra|codex|grok|llama|mistral|particle-1|deepseek|qwen)\b',
 'masked model token': r'\[model\]',
 'arm name': r'(?i)\b(no-gstack|placebo)\b|gstack-[a-z]+-[a-z]+',
 'OpenAI key': r'sk-[A-Za-z0-9_-]{20,}', 'Anthropic key': r'sk-ant-', 'GitHub token': r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_',
 'AWS key': r'AKIA[0-9A-Z]{16}', 'Slack token': r'xox[abprs]-', 'private key block': r'-----BEGIN [A-Z ]*PRIVATE KEY',
 'JWT': r'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}', 'key word with value': r'(?i)(api[_-]?key|secret|password|bearer)\s*[:=]\s*\S{8,}',
 'tunnel hostname': r'(?i)trycloudflare|ngrok|loca\.lt',
}
CHROME_ONLY = {
 'grader words': r'(?i)\b(graders?|grading|judge[sd]?|judging|verdicts?|kappa|calibrat\w*|rubric|benchmark)\b',
 'model words': r'(?i)\b(models?|LLMs?|language model)\b',
 'arm words': r'(?i)\b(arms?|conditions?|variants?|treatment)\b',
 'earlier answers': r'(?i)\b(earlier|previous|prior|original|first[- ]round|your first)\s+(answers?|labels?|readings?|choices?|round)\b|\bfirst (answers?|labels?)\b',
 'the other labeller': r'(?i)\b(other|another|second|both|two|fellow)\s+labell?ers?\b|\blabell?ers\b|\bdisagree\w*\b',
}
MATERIAL_REVIEW = {'grader or model word in the material': r'(?i)\b(models?|judge[sd]?|graders?|verdicts?|arms?|sol)\b'}
REVIEW = {'email address': r'[\w.+-]+@[\w-]+\.[\w.-]+', 'URL': r'https?://[^\s"\')<]+'}
hits = collections.defaultdict(collections.Counter); review = collections.defaultdict(collections.Counter)
def scan(rel, text, rules, sink):
    for k, rx in rules.items():
        for m in re.finditer(rx, text):
            ctx = text[max(0, m.start() - 40):m.end() + 40].replace('\n', ' ')
            sink[k][(rel, ctx)] += 1
def material_of(data):
    return '\n'.join(b['text'] for s in data.get('screens', {}).values() for b in s.get('blocks', []))
def chrome_of(data):
    d = json.loads(json.dumps(data))
    for s in d.get('screens', {}).values():
        for b in s.get('blocks', []): b['text'] = ''
    return json.dumps(d)
for p in files:
    t = open(p, encoding='utf-8', errors='replace').read(); rel = os.path.relpath(p, root)
    if rel.endswith('.html') or rel == 'items.json':
        if rel.endswith('.html'):
            m = re.search(r'<script type="application/json" id="data">(.*?)</script>', t, re.S)
            data = json.loads(m.group(1).replace('<\\/', '</')) if m else {}
            chrome = re.sub(r'<script type="application/json" id="data">.*?</script>', ' ', t, flags=re.S) + chrome_of(data)
        else:
            data = json.loads(t); chrome = chrome_of(data)
        material = material_of(data)
        scan(rel, chrome, {**EVERYWHERE, **CHROME_ONLY}, hits)
        scan(rel, material, EVERYWHERE, hits)
        scan(rel, material, MATERIAL_REVIEW, review)
        scan(rel, material, REVIEW, review)
    else:
        scan(rel, t, {**EVERYWHERE, **CHROME_ONLY}, hits)
        scan(rel, t, REVIEW, review)
print('files checked:', len(files))
for f in files: print('  ', os.path.relpath(f, root), os.path.getsize(f), 'bytes')
print('BLOCKING HITS:', sum(sum(c.values()) for c in hits.values()))
for k, c in hits.items():
    for (f, s), n in c.most_common(15): print(f'  {k}: {f}: ...{s}... x{n}')
print('FOR REVIEW (allowed only in the real material, never in the page\'s own words):')
for k, c in review.items(): print(f'  {k}: {len(c)} distinct: ' + ', '.join(f'{f}: {s[:60]} x{n}' for (f, s), n in c.most_common(10)))
sys.exit(1 if hits else 0)
