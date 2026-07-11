import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { unlink, realpathSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

// tag:    agent wraps spoken text in <say>…</say>; spans are spoken live and the
//         tags are stripped from the transcript.
// stream: no tags; speak the reply paragraph by paragraph, skipping code/tables.
type Mode = "tag" | "stream";

const OPEN = "<say>";
const CLOSE = "</say>";

export default function (pi: ExtensionAPI) {
  // Defaults so voice works on load; /simplesay overrides for the session.
  // Default to stream so it works with zero agent config (tag mode needs the
  // agent to emit <say> markers).
  let mode: Mode = "stream";
  let agentName = process.env.SIMPLESAY_AGENT ?? "fabricant";
  // SIMPLESAY_ENDPOINT lets a given machine pin its own speech endpoint
  // (e.g. a shared box-wide `say` script) without editing this file. With
  // no env var set, falls back to the bundled example endpoint shipped in
  // this repo (../examples/endpoint.sh), resolved relative to this file so
  // it works regardless of CWD.
  // Resolve symlinks so the path works when the extension is symlinked
  // into pi's extensions dir (e.g. ~/.pi/agent/extensions/simplesay.ts →
  // /path/to/simplesay/src/index.ts). Without realpathSync, import.meta.url
  // points to the symlink location, not the real file, so the relative
  // path to examples/endpoint.sh breaks.
  const realPath = realpathSync(fileURLToPath(import.meta.url));
  const bundledDefault = join(dirname(realPath), "..", "examples", "endpoint.sh");
  let endpoint = process.env.SIMPLESAY_ENDPOINT ?? bundledDefault;
  let agentFlag = true;

  // Per-message stream state.
  let acc = "";         // streamed text not yet parsed
  let speaking = false; // inside a <say> span (tag mode)
  let buf = "";         // text held for the next utterance
  let para = "";        // current paragraph (stream mode)
  let inFence = false;  // inside a ``` block (stream mode)
  let sawText = false;  // any streamed text this message

  // Pipeline so there's no dead air between utterances: synthChain renders each
  // WAV ahead (fast), playChain plays them in order (slow). The next utterance
  // synthesizes while the current one is still playing.
  let synthChain: Promise<unknown> = Promise.resolve();
  let playChain: Promise<unknown> = Promise.resolve();
  let seq = 0;

  function reset() {
    acc = buf = para = "";
    speaking = inFence = sawText = false;
  }

  // Provider-agnostic: strip everything that reads badly aloud, leave plain prose.
  function clean(t: string): string {
    return t
      .replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ") // code blocks
      .split(OPEN).join("").split(CLOSE).join("")                      // say tags
      .replace(/^\s*\|.*\|\s*$/gm, " ")                                // table rows
      .replace(/\$\$?([^$]*[\\^_][^$]*)\$\$?/g, " $1 ")                // unwrap $…$ math; leaves $5 currency
      .replace(/\\(?:rightarrow|to|longrightarrow|Rightarrow|implies|mapsto)\b/g, " to ")
      .replace(/\\(?:leftarrow|gets|longleftarrow|Leftarrow)\b/g, " from ")
      .replace(/\\[a-zA-Z]+\*?/g, " ")                                 // other LaTeX commands
      .replace(/[{}\\^]/g, " ")                                        // stray braces/backslashes/carets
      .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")                  // [[wikilinks]]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")                       // [text](url), images
      .replace(/`([^`]*)`/g, "$1")                                     // inline code
      .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1") // **bold**/*italic*
      .replace(/__([^_]+)__/g, "$1")                                   // __bold__
      .replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, "$1")      // _italic_ (not file_name)
      .replace(/\*/g, " ")                                             // stray asterisks
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")                              // headers
      .replace(/^\s*[-*+]\s+/gm, "")                                   // bullets
      .replace(/^\s*>\s?/gm, "")                                       // blockquotes
      .replace(/https?:\/\/\S+/g, " ")                                 // bare URLs
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function speak(raw: string) {
    const text = clean(raw);
    if (!text || !endpoint) return;
    const args = agentFlag ? ["--agent", agentName, text] : [text];
    const wav = `/tmp/simplesay-${process.pid}-${seq++}.wav`;

    // Synthesize to a WAV ahead of playback (SAY_OUT skips the endpoint's play step).
    const synth = (synthChain = synthChain
      .then(() => execFileAsync(endpoint, args, { env: { ...process.env, SAY_OUT: wav } }))
      .then(() => true)
      .catch((e) => { console.error("[simplesay]", e); return false; }));

    // Play in order once this utterance is ready, then clean up the WAV.
    playChain = playChain
      .then(() => synth)
      .then((ok) => (ok ? execFileAsync(endpoint, ["--play", wav]) : undefined))
      .catch((e) => console.error("[simplesay]", e))
      .finally(() => unlink(wav, () => {}));
  }

  // tag mode: speak each <say>…</say> span as one utterance once it closes.
  function parseTags(final: boolean) {
    const tail = Math.max(OPEN.length, CLOSE.length) - 1; // hold for a split marker
    for (;;) {
      if (!speaking) {
        const i = acc.indexOf(OPEN);
        if (i < 0) { acc = final ? "" : acc.slice(-tail); return; }
        acc = acc.slice(i + OPEN.length);
        speaking = true;
      } else {
        const j = acc.indexOf(CLOSE);
        if (j < 0) {
          const safe = final ? acc.length : Math.max(0, acc.length - tail);
          buf += acc.slice(0, safe);
          acc = acc.slice(safe);
          if (final && buf.trim()) { speak(buf); buf = ""; speaking = false; }
          return;
        }
        buf += acc.slice(0, j);
        acc = acc.slice(j + CLOSE.length);
        if (buf.trim()) speak(buf);
        buf = "";
        speaking = false;
      }
    }
  }

  // stream mode: emit a paragraph (blank-line delimited) once complete, skipping
  // fenced code, table rows, and non-prose lines.
  function parseStream(final: boolean) {
    let chunk: string;
    if (final) { chunk = acc; acc = ""; }
    else {
      const nl = acc.lastIndexOf("\n");
      if (nl < 0) return; // no complete line yet
      chunk = acc.slice(0, nl + 1);
      acc = acc.slice(nl + 1);
    }
    const lines = chunk.split("\n");
    if (chunk.endsWith("\n")) lines.pop();
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; flushPara(); continue; }
      if (inFence) continue;
      if (line.trim() === "") { flushPara(); continue; }
      const s = line.trim();
      if ((s.startsWith("|") && s.endsWith("|")) || !/[A-Za-z]/.test(s)) continue; // tables, symbol soup
      para += (para ? " " : "") + s;
    }
    if (final) flushPara();
  }

  function flushPara() {
    if (para.trim()) speak(para);
    para = "";
  }

  const textOf = (m: any): string =>
    m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");

  pi.registerCommand("simplesay", {
    description: "Configure SimpleSay voice: /simplesay mode <tag|stream> | /simplesay <agent> <endpoint> [--no-agent]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);

      if (parts[0] === "mode") {
        const m = parts[1];
        if (m !== "tag" && m !== "stream") {
          ctx.ui.notify("Usage: /simplesay mode <tag|stream>", "error");
          return;
        }
        mode = m;
        ctx.ui.notify(`SimpleSay mode: ${mode}`, "info");
        return;
      }

      if (parts.length < 2) {
        ctx.ui.notify("Usage: /simplesay mode <tag|stream> | /simplesay <agent> <endpoint> [--no-agent]", "error");
        return;
      }
      const [a, ep] = parts;
      try {
        await execFileAsync("test", ["-x", ep]);
      } catch {
        ctx.ui.notify(`Endpoint not executable: ${ep}`, "error");
        return;
      }
      agentName = a;
      endpoint = ep;
      agentFlag = !parts.includes("--no-agent");
      ctx.ui.notify(`SimpleSay: agent='${agentName}', endpoint='${endpoint}'`, "info");
    },
  });

  pi.on("message_update", async (event) => {
    const a: any = (event as any).assistantMessageEvent;
    if (!a) return;
    if (a.type === "start") { reset(); return; }
    if (a.type === "text_delta" && typeof a.delta === "string") {
      sawText = true;
      acc += a.delta;
      mode === "tag" ? parseTags(false) : parseStream(false);
    }
  });

  pi.on("message_end", async (event) => {
    const msg = event.message;
    if (msg.role !== "assistant") return;

    if (!sawText) acc = textOf(msg); // provider didn't stream — use final text

    if (mode === "stream") {
      parseStream(true);
      reset();
      return;
    }

    parseTags(true);
    reset();

    // Strip <say> tags from the displayed message (keep the inner text).
    const tagged = msg.content.some(
      (c: any) => c.type === "text" && (c.text.includes(OPEN) || c.text.includes(CLOSE)),
    );
    if (!tagged) return;
    const content = msg.content.map((c: any) =>
      c.type === "text"
        ? { ...c, text: c.text.split(OPEN).join("").split(CLOSE).join("").replace(/[ \t]{2,}/g, " ") }
        : c,
    );
    return { message: { ...msg, content } };
  });
}
