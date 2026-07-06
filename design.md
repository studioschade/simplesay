# SimpleSay — design

## Why it exists
SimpleSay is a Pi extension that voices an agent's replies. The obvious approach —
have the agent call a `say` tool itself (how the Claude Code agents do it) — is
unreliable on local models, which routinely miss or malform tool calls. So instead
the extension watches the response stream and drives speech automatically. Plain
text markers (`<say>`) are far more reliable for a local model than a structured
tool call, which is the whole reason the tag mode works where a tool call wouldn't.

It does **not** ship a TTS engine. It shells out to a configurable endpoint — here,
sovereign's shared `say` (Kokoros + box-wide playback lock). All structural text
cleanup happens in the extension so it's **provider-agnostic**: swap the endpoint
and the text is still speech-ready.

## Modes
Two modes, both live (speech happens as the reply streams). Select with a constant
default (`stream`) or at runtime: `/simplesay mode <tag|stream>`.

- **`tag`** — the agent wraps spoken text in `<say>…</say>`. Each span is spoken as
  one utterance when its close tag arrives. At `message_end` the tags are stripped
  from the displayed message (inner text kept). Whether the agent tags one trailing
  summary or several inline spans is a prompting choice, not code.
- **`stream`** — no tags. The reply is spoken paragraph by paragraph (blank-line
  delimited) as it streams. Fenced code blocks, table rows, and non-prose lines are
  skipped outright; the rest is cleaned and spoken. Fully automatic.

## How it works
- **Streaming input:** `pi.on("message_update")` delivers `assistantMessageEvent`, a
  union whose text arrives as `{ type: "text_delta", delta }`. Deltas feed the active
  mode's parser. (Thinking/tool-call deltas are ignored, so neither is spoken.)
- **Tag parser:** accumulates streamed text, retains a short tail each delta so a tag
  split across chunks is never missed, and speaks a span when `</say>` lands.
- **Stream parser:** consumes complete lines, tracks fenced-code state, and flushes a
  paragraph on the blank line that ends it (or at message end).
- **Cleanup (`clean()`):** provider-agnostic. Strips code blocks/spans, tables, `<say>`
  tags, headers, emphasis (`** __ * _`, incl. orphan/triple asterisks), links/images/
  bare URLs, wikilinks, blockquotes, bullets, emoji; collapses whitespace. Preserves
  identifiers like `file_name`. Engine-specific normalization (number/year-to-words,
  lexicon) stays in the endpoint.
- **Dispatch:** `execFile(endpoint, …)` — no shell, so backticks / `$(…)` / quotes in a
  reply can't break or execute. To avoid dead air between utterances, synthesis is
  pipelined ahead of playback: each utterance is rendered to a temp WAV (`SAY_OUT`)
  while the previous one is still playing, then played in order via `--play`. The next
  paragraph starts the instant the current finishes.
- **Display rewrite (tag mode only):** `message_end` returns a replacement message
  (`MessageEndEventResult.message`) with the tags removed. `message_update` is
  live-only and can't be rewritten, so raw tags show for the instant they stream, then
  vanish when the message finalizes.

## Endpoint contract
```
<endpoint> [--agent <name>] "<text>"
```
`--agent` selects a persona voice; `<text>` is one cleaned utterance passed as a single
argument. The endpoint owns synthesis, pronunciation, and serialized playback. For
pipelining it also supports `SAY_OUT=<wav>` (synth only, no play) and `--play <wav>`
(play only, no synth) — an endpoint without those still works, just without synth-ahead.

## Configuration
Defaults are hardcoded (Pi has no persistent config store), so voice works on load:
`mode=tag`, `agent=fabricant`, `endpoint=/home/alshady/Agents/sovereign/Projects/tools/say`.
Override for the session:
- `/simplesay mode <tag|stream>`
- `/simplesay <agent> <endpoint> [--no-agent]`

## Agent prompt
The extension only detects/speaks; the agent must cooperate (tag mode) via its
`AGENTS.md`: wrap spoken text in `<say>…</say>`, keep code/tables/paths outside. Stream
mode needs no prompting.

## Limitations
- Tag mode shows raw tags for the moment they stream, before the finalize rewrite.
- Settings don't persist across sessions (no Pi config store).
- Tag mode depends on the model emitting tags; reliable for text, but not enforceable.
