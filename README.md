# Mainkick

An AI browser extension for Chrome, Edge and Brave (Manifest V3). It chats, summarizes, explains, translates, remembers, searches images, clicks buttons when you ask, and has a built-in editor. It uses your own Groq API key and is locked to `openai/gpt-oss-120b`.

## Layout

| Path | What it is |
| --- | --- |
| `extension/` | The extension source. Load this folder with **Load unpacked** to develop. |
| `site/` | The download page, served by Cloudflare Pages (output directory `site`, no build command). |
| `site/mainkick.zip` | The packaged extension that the site's Download button serves. |
| `scripts/build.sh` | Rebuilds `site/mainkick.zip` from `extension/`. |

## Releasing a new version

1. Bump `version` in `extension/manifest.json`, and update the version on `site/index.html`.
2. Run `./scripts/build.sh`.
3. Commit and push. Cloudflare redeploys the site.

## Features

- **Chat** with optional "Attach this page" context, Markdown answers, Copy / 🔊 Read / ✎ → Editor on every answer
- **Right-click** Summarize, Ask about, Translate, Google Images
- **Editor**: up to 20 autosaved drafts, word counts, Copy, Read, download `.txt`/`.md`, Insert into page (inserts all at once, like a paste)
- **AI powers** (toggles in Settings):
  - 🧠 Memory: the AI writes `<remember>…</remember>` and the notes are stored in `chrome.storage.local`. You can edit them in Settings.
  - 🖼️ Image search: the AI writes `<searchimg query>`, which opens a Google Images tab in the background (max 3 per answer).
  - 🖱️ Page clicks: off by default. With the page attached, the AI writes `<click N>` for a numbered element, and you confirm. Risky-looking buttons (buy, delete, sign out…) always ask.
- **Quick prompts**: editable in Settings (`Label | prompt`, one per line)
- **Shortcuts**: `Alt+M` opens Mainkick, `Alt+S` summarizes the selection
- **Export chat** as Markdown

## Storage keys

`mk_settings`, `mk_chat` (session or local), `mk_cache`, `mk_memory`, `mk_drafts`, `mk_panel_size`.
