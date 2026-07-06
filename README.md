# SimpleSay

A Pi extension that voices an agent's replies automatically by watching the
response stream — built because local models miss tool calls, so an agent can't be
relied on to call a `say` tool itself. See [design.md](design.md) for the rationale.

## Modes
- **`stream`** (default): no tags, zero agent config — the reply is spoken paragraph by
  paragraph as it streams, with code, tables, and non-prose skipped.
- **`tag`**: the agent wraps spoken text in `<say>…</say>`; spans are spoken live and the
  tags are stripped from the transcript. Requires the agent to emit the markers.

Switch at runtime: `/simplesay mode <tag|stream>`.

## Speech endpoint
SimpleSay ships no TTS engine — it shells out to a configurable endpoint with the
contract `<endpoint> [--agent <name>] "<text>"`. All structural text cleanup is done in
the extension, so any endpoint works.

With no configuration at all, it defaults to the bundled
[`examples/endpoint.sh`](examples/endpoint.sh) (a minimal cross-platform reference
endpoint using `say`/`espeak`/`spd-say`), resolved relative to the extension file so it
works regardless of current directory — voice works out of the box on a fresh clone.

To pin your own endpoint (a shared TTS server, a specific voice setup, etc.) without
editing the source, set environment variables before starting Pi:
```bash
export SIMPLESAY_ENDPOINT=/path/to/your/say/script
export SIMPLESAY_AGENT=your-agent-name   # optional, defaults to 'fabricant'
```
Or override for just the current session:
```
/simplesay <agent> <endpoint> [--no-agent]
```
Defaults: `mode=stream` (hardcoded — no persistent config store in Pi), `agent` and
`endpoint` read from `SIMPLESAY_AGENT`/`SIMPLESAY_ENDPOINT` if set, otherwise
`agent=fabricant` and the bundled example endpoint above.

## Install / run
Symlink `src/index.ts` into pi's extension auto-discovery path (recommended, so this
repo stays the single source of truth — no manual sync needed):
```bash
ln -s /path/to/simplesay/src/index.ts ~/.pi/agent/extensions/simplesay.ts   # global
# or
ln -s /path/to/simplesay/src/index.ts .pi/extensions/simplesay.ts           # project-local
```
To try it ad hoc without installing: `pi -e /path/to/simplesay/src/index.ts`

## Example: a Kokoro-based endpoint
SimpleSay ships no TTS engine by design — it just shells out to whatever endpoint you
point it at, following the contract above. Our own setup runs [Kokoros](https://github.com/lucasjinreal/Kokoros)
(a fast Rust reimplementation of Kokoro TTS) as a resident local server exposing an
OpenAI-compatible speech API, wrapped in a small shell script that:
- POSTs cleaned text to the resident Kokoros server (warm model, sub-second latency)
- Falls back to a CLI invocation if the server isn't up
- Serializes playback box-wide with a file lock, so concurrent speakers queue instead of
  talking over each other
- Maps a `--agent <name>` flag to a per-agent voice (handy if multiple personas share one
  machine)
- Honors the `SAY_OUT=<wav>` / `--play <wav>` split described above for synth-ahead pipelining

None of that is specific to this extension — any script matching the endpoint contract
works, whether it wraps Kokoro, a cloud TTS API, or `espeak`. `examples/endpoint.sh` is a
minimal cross-platform stand-in (`say`/`espeak`/`spd-say`) to get started without any of
the above.

## Agent prompt (tag mode)
The agent must wrap spoken text in `<say>…</say>` and keep code/tables/paths outside.
See the Speech section of the agent's `AGENTS.md`. Stream mode needs no prompting.

- **Source:** `src/index.ts`
- **Design:** `design.md`
