// Copyright (c) 2026 Garry Tan. MIT License.
// Python re to JavaScript, for the shared frame's mechanical rules (design prereg frame-rules.md part B, which the devex
// prereg's section 4 shares) and the screen rule (lanes/devex/mine/screen-rule.md): the regexes stay byte for byte as
// Python wrote them, and py() compiles each into a JavaScript RegExp with Python 3's str semantics. Python's \w, \b and
// \d are Unicode-aware and its \s is str.isspace; its "." matches "\r"; its "$" without MULTILINE also matches before
// a final newline, and with MULTILINE "^" and "$" see only "\n". JavaScript differs on each, so py() rewrites them.
// Leading inline flags such as (?im) become flags. Anything py() can't port throws rather than guessing.

const W = "\\p{L}\\p{N}_";
const S = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const B = "(?:(?<=[" + W + "])(?![" + W + "])|(?<![" + W + "])(?=[" + W + "]))";
const NB = "(?:(?<=[" + W + "])(?=[" + W + "])|(?<![" + W + "])(?![" + W + "]))";
const SYNTAX = "^$\\.*+?()[]{}|/";

export interface PyFlags {
  I?: boolean;
  M?: boolean;
  S?: boolean;
}

/** Compiles a Python re pattern (str semantics) to a JavaScript RegExp; g adds the global flag for match loops. */
export function py(pattern: string, flags: PyFlags = {}, g = false): RegExp {
  let src = pattern;
  const f = { ...flags };
  const inline = /^\(\?([imsu]+)\)/.exec(src);
  if (inline) {
    for (const c of inline[1]!) {
      if (c === "i") f.I = true;
      else if (c === "m") f.M = true;
      else if (c === "s") f.S = true;
    }
    src = src.slice(inline[0].length);
  }
  let out = "";
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "\\") {
      const d = src[i + 1];
      if (d === undefined) throw new Error("py: trailing backslash");
      i++;
      if (d === "w") out += inClass ? W : "[" + W + "]";
      else if (d === "s") out += inClass ? S : "[" + S + "]";
      else if (d === "d") out += "\\p{Nd}";
      else if (!inClass && d === "W") out += "[^" + W + "]";
      else if (!inClass && d === "S") out += "[^" + S + "]";
      else if (!inClass && d === "D") out += "\\P{Nd}";
      else if (!inClass && d === "b") out += B;
      else if (!inClass && d === "B") out += NB;
      else if (!inClass && d === "A") out += "(?<![\\s\\S])";
      else if (!inClass && d === "Z") out += "(?![\\s\\S])";
      else if (d === "x" && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 1, i + 3))) {
        out += "\\x" + src.slice(i + 1, i + 3);
        i += 2;
      } else if ("tnrfv".includes(d)) out += "\\" + d;
      else if (/[A-Za-z0-9]/.test(d)) throw new Error("py: unsupported escape \\" + d);
      else if (SYNTAX.includes(d) || (inClass && d === "-")) out += "\\" + d;
      else out += d;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      else if (c === "[") {
        out += "\\[";
        continue;
      }
      out += c;
      continue;
    }
    if (c === "[") {
      inClass = true;
      out += "[";
      if (src[i + 1] === "^") {
        out += "^";
        i++;
      }
      if (src[i + 1] === "]") {
        out += "\\]";
        i++;
      }
      continue;
    }
    if (c === "(" && src.startsWith("(?P", i)) throw new Error("py: named groups not supported");
    if (c === ".") out += f.S ? "[\\s\\S]" : "[^\\n]";
    else if (c === "$") out += f.M ? "(?=\\n|(?![\\s\\S]))" : "(?=\\n?(?![\\s\\S]))";
    else if (c === "^") out += f.M ? "(?<=\\n|(?<![\\s\\S]))" : "(?<![\\s\\S])";
    else out += c;
  }
  if (inClass) throw new Error("py: unterminated class");
  return new RegExp(out, "u" + (f.I ? "i" : "") + (g ? "g" : ""));
}

/** Escapes a literal token for py(). */
export const pyEscape = (s: string) => s.replace(/[.*+?^$\\{}()|[\]\/-]/g, (c) => "\\" + c);
