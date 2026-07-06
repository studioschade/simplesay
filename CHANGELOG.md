# Changelog

## 0.1.0 — 2026-06-21

Initial version.

- **Two speech modes**, both live (speech starts while the reply is still
  streaming), selectable at runtime via `/simplesay mode <tag|stream>`:
  - `tag` — the agent wraps spoken text in `<say>…</say>`; each span is
    spoken as one utterance when its closing tag arrives, then stripped
    from the displayed message at `message_end` (inner text kept).
  - `stream` — no tags required. The reply is spoken paragraph by
    paragraph (blank-line delimited) as it streams; fenced code blocks,
    table rows, and other non-prose lines are skipped automatically.
- **Provider-agnostic endpoint contract**: `<endpoint> [--agent <name>]
  "<text>"`. The extension does all structural text cleanup and owns
  nothing about synthesis — any script matching the contract works,
  whether it wraps a cloud TTS API, Kokoro, or `espeak`.
- **Synth-ahead pipelining**: each utterance renders to a temp WAV
  (`SAY_OUT=<wav>`) while the previous one still plays, then plays in
  order via `--play <wav>` — no dead air between utterances. An endpoint
  without those flags still works, just without the pipelining.
- **`clean()` text normalizer**: strips code blocks/spans, tables, `<say>`
  tags, headers, emphasis markers, links/images/bare URLs, wikilinks,
  blockquotes, bullets, and emoji; collapses whitespace; preserves
  identifiers like `file_name` so they aren't mangled before reaching the
  endpoint.
- **Safe dispatch**: `execFile(endpoint, …)` — no shell involved, so
  backticks, `$(…)`, or quotes inside a reply can't break or execute
  anything on the way to the speech endpoint.
- `examples/endpoint.sh` — a minimal cross-platform reference endpoint
  (`say` / `espeak` / `spd-say`) so the extension is speech-ready without
  any particular TTS stack installed.
- Runtime configuration commands: `/simplesay mode <tag|stream>` and
  `/simplesay <agent> <endpoint> [--no-agent]`. Defaults are hardcoded
  since Pi has no persistent config store, so voice works immediately on
  load without any setup.
