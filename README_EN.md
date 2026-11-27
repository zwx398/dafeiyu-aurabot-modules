# Dafeiyu · Aurabot Modules

> Modules for [Aurabot](https://github.com/aureth-labs/dsh-aurabot-qq) — the host plugin behind
> my QQ / Douyin AI companion "Dafeiyu": cloned voice, meme-wiki lookup, group privacy,
> Douyin comment enhancements, and cross-platform memory bridges.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Aurabot Module](https://img.shields.io/badge/Aurabot-module-6f42c1.svg)](https://github.com/aureth-labs/dsh-aurabot-qq)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](#requirements)

*[中文说明见 README.md](README.md)*

## What is this

Each `modules/<name>/` is a drop-in Aurabot module (ESM, `api: 1`).
The repo also ships a fork of the community Douyin module (2.3.8) with my changes.

## Quick start

Paste this to your agent:

> Install the modules from this repo into my local Aurabot: run `install.ps1 -DryRun` first,
> then run it for real, install whatever dependencies it reports as missing, restart Aurabot,
> and confirm each module logged a startup line.

Or by hand:

```powershell
git clone https://github.com/zwx398/dafeiyu-aurabot-modules.git
cd dafeiyu-aurabot-modules
powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File install.ps1
```

## Modules

| Module | What it does |
| --- | --- |
| `voice` | Cloned voice for QQ messages (Breeze TTS 2): identity check, five speaking styles, rate correction |
| `voice-bridge` | Lends the QQ voice to the Douyin video factory |
| `qq-memewiki` | Meme-wiki lookup before replying; no guessing when a meme is unknown |
| `qq-group-privacy` | Group-chat privacy: blocked words, segment allow-list, voice pass-through |
| `qq-group-self` | Self-awareness in group chats: who "she" means, what she did on other platforms |
| `qq-reply-guard` | Reply guard: strips leaked English self-check notes and de-duplicates a re-copied answer before sending |
| `douyin` | Douyin: comment @s, threaded replies, sticker collecting, image comments, reading comment stickers |
| `douyin-at` | HTTP bridge for "comment on this video and really @ the owner" |
| `douyin-memory-bridge` | Streams memory into the Douyin video factory |
| `dsh-memory-bridge` | Writes DSH client conversations into the same memory the QQ/Douyin fish uses |

## Requirements

Windows, Aurabot (`dsh-aurabot-qq`) with working QQ messaging, Node.js,
Breeze TTS 2 + q8 weights + a `.breeze` voice (voice modules only), ffmpeg,
`dsh-memewiki` (for `qq-memewiki`), `dsh-douyin-studio` (for the Douyin bridges).

Missing pieces only disable the module that needs them — run `install.ps1` to see what is missing.

## Configuration

Paths are resolved as: config file → environment variables → auto-detection
(see [`modules/voice/paths.mjs`](modules/voice/paths.mjs)), so no code edits per machine.
Environment variables: `DAFEIYU_DATA_DIR`, `DAFEIYU_BREEZE_HOME`, `DAFEIYU_BREEZE_CLI`,
`DAFEIYU_BREEZE_MODEL`, `DAFEIYU_VOICES_DIR`, `DAFEIYU_FFMPEG`, `DAFEIYU_MOOD`,
`DAFEIYU_BASELINE`, `DAFEIYU_CHATLOG`, `DAFEIYU_STUDIO_MEMORY`, `DSH_HOME`.

## Known limitations

- Tested on Windows only.
- `modules/douyin` is a fork of community 2.3.8 and may lag upstream.
- No voice files, meme database, model weights, login state, or memory data are included.

## License

MIT for everything except `modules/douyin`, which keeps the upstream MIT license
(see [NOTICE-douyin.md](NOTICE-douyin.md)).
