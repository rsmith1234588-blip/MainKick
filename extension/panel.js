// The chat, editor and settings UI. It only *displays* what is saved in storage and asks the background worker to do
// things, so closing it, switching tabs or losing focus never loses a conversation, a draft or a pending answer.
(() => {
  if (window.MainkickPanel) return;

  const { KEYS } = MK;
  const md = window.MainkickMarkdown;

  const CSS = `
:host { all: initial; }
.panel {
  --bg: #060908; --bg2: #0c1310; --fg: #e6f2ea; --muted: #84a090; --line: #1a2820; --soft: #101a15; --soft2: #1f3028;
  --accent: #34e873; --accent-dim: #20b455; --accent-fg: #03140a; --code: rgba(52, 232, 115, 0.09);
  --err-bg: #2a0e0e; --err-fg: #ff8080; --ok: #34e873; --warn: #ffd23f;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", "Cascadia Code", Menlo, Consolas, monospace;
  box-sizing: border-box; display: flex; flex-direction: column; width: 100%; height: 100%;
  padding: 14px; background: var(--bg); color: var(--fg); color-scheme: dark;
  font: 13.5px/1.55 var(--sans); -webkit-font-smoothing: antialiased;
  border: 1px solid var(--line); border-radius: 18px; overflow: hidden;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.02);
  background-image: radial-gradient(120% 60% at 50% -15%, rgba(52, 232, 115, 0.13), transparent 65%);
}
.panel.embedded { border: 0; border-radius: 0; box-shadow: none; }
.panel *, .panel *::before, .panel *::after { box-sizing: border-box; }
.panel button, .panel input, .panel select, .panel textarea { font: inherit; color: inherit; }
.panel ::selection { background: var(--accent); color: var(--accent-fg); }
.panel ::-webkit-scrollbar { width: 8px; height: 8px; }
.panel ::-webkit-scrollbar-thumb { background: var(--soft2); border-radius: 8px; }
.panel ::-webkit-scrollbar-track { background: transparent; }

/* ---------- Header ---------- */
.nav { display: flex; align-items: center; gap: 8px; padding-bottom: 12px; margin-bottom: 10px; border-bottom: 1px solid var(--line); cursor: grab; user-select: none; }
.panel.embedded .nav { cursor: default; }
.brand { margin-right: auto; white-space: nowrap; font-weight: 800; font-size: 16px; letter-spacing: -0.01em; color: var(--fg); display: flex; align-items: center; gap: 8px; }
.brand::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
.brand .dim { color: var(--accent); }
.glitch { display: inline-block; }
.cursor { display: none; }

.tabs { display: flex; gap: 2px; padding: 3px; background: var(--soft); border: 1px solid var(--line); border-radius: 999px; }
.tab { background: none; color: var(--muted); border: 0; padding: 4px 12px; border-radius: 999px; font-weight: 600; cursor: pointer; font-size: 12px; }
.tab:hover { color: var(--fg); }
.tab.active { background: var(--accent); color: var(--accent-fg); }
.icon-btn { background: none; border: 0; cursor: pointer; color: var(--muted); font-size: 14px; padding: 5px 7px; border-radius: 8px; line-height: 1; }
.icon-btn:hover { background: var(--soft); color: var(--accent); }
.panel.embedded .close { display: none; }
.panel :focus-visible { outline: 2px solid rgba(52, 232, 115, 0.6); outline-offset: 1px; }

.view { display: none; flex-direction: column; flex: 1; min-height: 0; }
.view.active { display: flex; }

/* ---------- Chat ---------- */
.log { flex: 1; overflow-y: auto; padding: 2px 2px 8px; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; }
.msg { padding: 9px 13px; border-radius: 16px; max-width: 90%; word-wrap: break-word; overflow-wrap: anywhere; }
.msg.user { background: var(--accent); color: var(--accent-fg); font-weight: 500; border-bottom-right-radius: 5px; align-self: flex-end; white-space: pre-wrap; }
.msg.user .quote, .msg.user .head, .msg.user .tag { color: inherit; }
.msg.ai { background: var(--bg2); border: 1px solid var(--line); border-bottom-left-radius: 5px; align-self: flex-start; }
.msg.error { background: var(--err-bg); color: var(--err-fg); border: 1px solid #5a1a1a; align-self: flex-start; }
.msg.welcome { background: transparent; border: 1px dashed var(--soft2); align-self: flex-start; color: var(--muted); }
.msg.welcome b { color: var(--accent); }
.msg .head { font-weight: 700; display: block; color: var(--accent); }
.msg.user .head { color: var(--accent-fg); }
.msg .quote { display: block; opacity: 0.85; font-style: italic; }
.msg .tag { display: inline-block; font-size: 11px; color: var(--muted); margin-top: 4px; }
.chip { display: inline-block; margin: 6px 4px 0 0; font-size: 11.5px; border: 1px solid var(--soft2); color: var(--fg); background: var(--soft); border-radius: 999px; padding: 2px 10px; cursor: pointer; text-align: left; }
.chip:hover { border-color: var(--accent); color: var(--accent); }
.chip.static { cursor: default; }
.chip.static:hover { border-color: var(--soft2); color: var(--fg); }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 11.5px; color: var(--muted); align-items: center; }
.actions button { background: none; border: 0; padding: 0; cursor: pointer; color: var(--muted); font-size: 11.5px; }
.actions button:hover { color: var(--accent); }

.msg.ai > :first-child { margin-top: 0; }
.msg.ai > :last-child { margin-bottom: 0; }
.msg.ai p, .msg.ai ul, .msg.ai ol, .msg.ai pre, .msg.ai blockquote, .msg.ai .table-wrap { margin: 0 0 8px; }
.msg.ai h1, .msg.ai h2, .msg.ai h3, .msg.ai h4, .msg.ai h5, .msg.ai h6 { margin: 12px 0 6px; line-height: 1.3; color: var(--fg); letter-spacing: -0.01em; }
.msg.ai h1 { font-size: 16.5px; } .msg.ai h2 { font-size: 15.5px; } .msg.ai h3 { font-size: 14.5px; }
.msg.ai h4, .msg.ai h5, .msg.ai h6 { font-size: 13.5px; }
.msg.ai ul, .msg.ai ol { padding-left: 20px; }
.msg.ai li { margin: 2px 0; }
.msg.ai li::marker { color: var(--accent-dim); }
.msg.ai li.task { list-style: none; margin-left: -16px; }
.msg.ai strong { color: #fff; }
.msg.ai code { background: var(--code); padding: 1px 5px; border-radius: 5px; color: #a6f7c3; font: 12px var(--mono); }
.msg.ai pre { background: #030504; border: 1px solid var(--line); padding: 10px 12px; border-radius: 10px; overflow-x: auto; }
.msg.ai pre code { background: none; padding: 0; white-space: pre; }
.msg.ai blockquote { border-left: 3px solid var(--accent-dim); padding-left: 10px; color: var(--muted); }
.msg.ai hr { border: 0; border-top: 1px solid var(--soft2); margin: 10px 0; }
.msg.ai a { color: var(--accent); }
.msg.ai:has(.table-wrap) { max-width: 100%; align-self: stretch; }
.msg.ai .table-wrap { overflow-x: auto; max-width: 100%; border: 1px solid var(--soft2); border-radius: 10px; }
.msg.ai table { border-collapse: collapse; font-size: 12px; width: 100%; color: inherit; line-height: inherit; }
.msg.ai th, .msg.ai td { border: 1px solid var(--soft2); padding: 5px 9px; text-align: left; vertical-align: top; overflow-wrap: break-word; word-break: normal; min-width: 4.5em; }
.msg.ai tr > :first-child { border-left: 0; } .msg.ai tr > :last-child { border-right: 0; }
.msg.ai thead tr > * { border-top: 0; } .msg.ai tbody tr:last-child > * { border-bottom: 0; }
.msg.ai th { background: var(--code); font-weight: 700; color: var(--accent); }
.msg.ai tbody tr:nth-child(even) td { background: rgba(52, 232, 115, 0.03); }

.card { align-self: stretch; border: 1px solid rgba(255, 210, 63, 0.55); background: rgba(255, 210, 63, 0.06); border-radius: 12px; padding: 9px 12px; font-size: 12.5px; }
.card.done { border-color: var(--line); background: var(--bg2); color: var(--muted); }
.card .card-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.card .warn { color: var(--warn); display: block; font-size: 11.5px; margin-top: 2px; }

.thinking { display: flex; align-items: center; gap: 4px; color: var(--muted); font-size: 12px; padding: 4px 4px; }
.thinking[hidden] { display: none; }
.thinking i { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: pulse 1s infinite ease-in-out; }
.thinking i:nth-child(2) { animation-delay: 0.15s; }
.thinking i:nth-child(3) { animation-delay: 0.3s; margin-right: 6px; }
@keyframes pulse { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }

.presets { display: flex; gap: 5px; overflow-x: auto; padding: 4px 0 2px; scrollbar-width: none; }
.presets:empty { display: none; }
.presets .chip { margin: 0; white-space: nowrap; flex: none; }
.attach { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); margin: 6px 0 8px; cursor: pointer; }
.attach input { accent-color: var(--accent); }
.panel.embedded .attach { display: none; }
.input-row { display: flex; gap: 6px; align-items: flex-end; }
textarea, input[type="text"], input[type="password"], select {
  width: 100%; padding: 8px 11px; border: 1px solid var(--soft2); border-radius: 12px; background: #040706; outline: none; font-size: 13px;
}
textarea::placeholder, input::placeholder { color: #4f6a5b; }
textarea:focus, input:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(52, 232, 115, 0.15); }
select option { background: #040706; }
.chat-input { resize: none; max-height: 110px; line-height: 1.4; }
.btn { background: var(--accent); color: var(--accent-fg); border: 1px solid var(--accent); padding: 8px 15px; border-radius: 999px; font-weight: 700; cursor: pointer; font-size: 12.5px; transition: box-shadow 0.15s, transform 0.15s; }
.btn:hover { box-shadow: 0 0 18px rgba(52, 232, 115, 0.4); }
.btn.secondary { background: var(--soft); color: var(--fg); border-color: var(--soft2); }
.btn.secondary:hover { border-color: var(--accent); color: var(--accent); box-shadow: none; }
.btn.small { padding: 5px 11px; font-size: 11.5px; font-weight: 600; }
.btn.danger:hover { border-color: var(--err-fg); color: var(--err-fg); }
.btn:disabled { opacity: 0.45; cursor: default; box-shadow: none; }

/* ---------- Editor ---------- */
.ed-top { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
.ed-top select { flex: 1; min-width: 0; }
.ed-text { flex: 1; min-height: 120px; resize: none; line-height: 1.6; padding: 12px; border-radius: 14px; }
.ed-meta { display: flex; justify-content: space-between; gap: 8px; font: 11px var(--mono); color: var(--muted); margin: 6px 0 8px; }
.ed-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.panel.embedded .insert { display: none; }
.ed-status { font-size: 12px; min-height: 18px; margin-top: 5px; color: var(--ok); }
.ed-status.bad { color: var(--err-fg); }

/* ---------- Settings ---------- */
.settings { overflow-y: auto; gap: 12px; padding-right: 4px; }
.section-title { font: 600 10.5px var(--mono); letter-spacing: 0.14em; color: var(--accent); text-transform: uppercase; border-top: 1px solid var(--line); padding-top: 14px; margin-top: 4px; }
.section-title:first-child { border-top: 0; padding-top: 0; }
.field label, .field .label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px; }
.field small { display: block; color: var(--muted); font-size: 11px; margin-top: 4px; }
.field small a { color: var(--accent); }
.locked { color: var(--muted); cursor: not-allowed; font-family: var(--mono); font-size: 12px; }
.row { display: flex; gap: 6px; align-items: center; }
.toggle { display: flex; align-items: flex-start; gap: 9px; font-size: 12.5px; cursor: pointer; }
.toggle input { margin: 3px 0 0; accent-color: var(--accent); }
.toggle span small { display: block; color: var(--muted); font-size: 11px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.presets-input { resize: vertical; min-height: 84px; font: 11.5px var(--mono); }
.status { font-size: 12px; color: var(--ok); min-height: 18px; text-align: center; }
.list { display: flex; flex-direction: column; gap: 5px; }
.list:empty::before { content: attr(data-empty); color: var(--muted); font-size: 11.5px; }
.list-item { display: flex; gap: 4px; align-items: center; }
.list-item input { padding: 5px 8px; font-size: 12px; }
.list-item .site { flex: 1; font-size: 12px; }

@media (prefers-reduced-motion: reduce) {
  .thinking i { animation: none !important; }
}
`;

  const HTML = `
<div class="nav">
  <div class="brand" aria-label="Mainkick"><span>Main<span class="dim">kick</span></span></div>
  <div class="tabs" role="tablist">
    <button type="button" class="tab active" data-tab="chat">Chat</button>
    <button type="button" class="tab" data-tab="editor">Editor</button>
    <button type="button" class="tab" data-tab="settings" title="Settings">⚙</button>
  </div>
  <button type="button" class="icon-btn close" title="Close (Esc)">✕</button>
</div>

<section class="view active" data-view="chat">
  <div class="log" role="log" aria-live="polite"></div>
  <div class="thinking" hidden><i></i><i></i><i></i>Thinking…</div>
  <div class="presets"></div>
  <label class="attach"><input type="checkbox" class="attach-cb"> <span class="attach-label">🔗 Attach this page</span></label>
  <form class="input-row">
    <textarea class="chat-input" rows="1" placeholder="Ask anything…" title="Enter to send, Shift+Enter for a new line"></textarea>
    <button type="button" class="icon-btn img-btn" title="Search Google Images for what you typed">🖼️</button>
    <button type="submit" class="btn send">Send</button>
  </form>
</section>

<section class="view" data-view="editor">
  <div class="ed-top">
    <select class="ed-drafts" title="Your drafts"></select>
    <button type="button" class="btn secondary small ed-new" title="Start a new draft">+ New</button>
    <button type="button" class="btn secondary small danger ed-delete" title="Delete this draft">🗑</button>
  </div>
  <textarea class="ed-text" spellcheck="true" placeholder="Your draft lives here. Send any AI answer with ✎ → Editor, then make it your own. It saves automatically."></textarea>
  <div class="ed-meta"><span class="ed-counts">0 words · 0 characters</span><span class="ed-saved"></span></div>
  <div class="ed-actions">
    <button type="button" class="btn small ed-copy">📋 Copy</button>
    <button type="button" class="btn secondary small ed-read">🔊 Read</button>
    <button type="button" class="btn secondary small ed-txt" title="Download as plain text">⤓ .txt</button>
    <button type="button" class="btn secondary small ed-md" title="Download as Markdown">⤓ .md</button>
    <button type="button" class="btn secondary small insert ed-insert" title="Put the whole draft into the last text box you clicked on the page">📥 Insert into page</button>
    <button type="button" class="btn secondary small danger ed-clear">Clear</button>
  </div>
  <div class="ed-status" aria-live="polite"></div>
</section>

<section class="view settings" data-view="settings">
  <div class="section-title">Connection</div>
  <div class="field">
    <label for="mk-key">Groq API key</label>
    <div class="row">
      <input id="mk-key" name="apiKey" type="password" placeholder="gsk_…" autocomplete="off" spellcheck="false">
      <button type="button" class="icon-btn reveal" title="Show or hide the key">👁️</button>
    </div>
    <small>Saved only in this browser's extension storage and sent only to Groq. <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">Get a free key</a></small>
  </div>
  <div class="field">
    <label for="mk-model">Model</label>
    <input id="mk-model" type="text" class="locked" readonly tabindex="-1">
    <small>🔒 Locked. Mainkick always uses this model.</small>
  </div>

  <div class="section-title">Answers</div>
  <div class="grid2">
    <div class="field">
      <label for="mk-style">Summary style</label>
      <select id="mk-style" name="summaryStyle">
        <option value="bullets">Bullet points</option>
        <option value="paragraph">Short paragraph</option>
        <option value="tldr">One-line TL;DR</option>
      </select>
    </div>
    <div class="field">
      <label for="mk-lang">Translate to</label>
      <select id="mk-lang" name="translateTo">
        <option>English</option><option>French</option><option>Spanish</option><option>German</option>
        <option>Italian</option><option>Portuguese</option><option>Chinese (Simplified)</option><option>Japanese</option>
        <option>Korean</option><option>Arabic</option><option>Hindi</option><option>Russian</option>
      </select>
    </div>
    <div class="field">
      <label for="mk-ctx">Page text to attach</label>
      <select id="mk-ctx" name="contextChars" data-number>
        <option value="3000">Short (3k chars)</option>
        <option value="6000">Medium (6k)</option>
        <option value="12000">Long (12k)</option>
      </select>
    </div>
    <div class="field">
      <label for="mk-hist">Chat history sent</label>
      <select id="mk-hist" name="historyMessages" data-number>
        <option value="4">Last 4 messages</option>
        <option value="10">Last 10</option>
        <option value="20">Last 20</option>
      </select>
    </div>
  </div>
  <div class="field">
    <label for="mk-presets">Quick prompts</label>
    <textarea id="mk-presets" name="presets" class="presets-input" spellcheck="false"></textarea>
    <small>One per line: <code>Button label | prompt</code>. They show above the chat box (up to 8).</small>
  </div>

  <div class="section-title">AI powers</div>
  <label class="toggle"><input type="checkbox" name="aiMemory">
    <span>🧠 Memory<small>The AI can save notes about you (in this browser only) and use them in later chats.</small></span></label>
  <label class="toggle"><input type="checkbox" name="aiImageSearch">
    <span>🖼️ AI image search<small>The AI can open Google Images searches in a background tab (up to 3 per answer).</small></span></label>
  <label class="toggle"><input type="checkbox" name="aiClick">
    <span>🖱️ AI page clicks<small>With "Attach this page" on, the AI can ask to click buttons or links. You confirm each click.</small></span></label>

  <div class="section-title">Browser</div>
  <label class="toggle"><input type="checkbox" name="rememberChats">
    <span>Keep chats after the browser closes<small>Off: the chat is cleared when you quit the browser.</small></span></label>
  <label class="toggle"><input type="checkbox" name="cacheResults">
    <span>Reuse earlier answers<small>Summarizing the same text twice won't call the API again.</small></span></label>
  <label class="toggle"><input type="checkbox" name="imageSearch">
    <span>"Search Google Images" in the right-click menu</span></label>

  <button type="button" class="btn save">Save settings</button>
  <div class="status" aria-live="polite"></div>

  <div class="section-title">Memory</div>
  <div class="list mem-list" data-empty="Nothing saved yet."></div>
  <form class="row mem-add">
    <input type="text" class="mem-input" placeholder="Add a memory, e.g. I'm in grade 11" maxlength="300">
    <button type="submit" class="btn secondary small">Add</button>
  </form>
  <button type="button" class="btn secondary small danger mem-clear">Forget everything</button>

  <div class="section-title">Click permissions</div>
  <div class="list site-list" data-empty="No sites have “always allow”."></div>

  <div class="section-title">Storage</div>
  <div class="field">
    <small class="usage">Checking…</small>
    <div class="row" style="margin-top:6px; flex-wrap: wrap">
      <button type="button" class="btn secondary small export-chat">⤓ Export chat</button>
      <button type="button" class="btn secondary small danger clear-chat">Clear chat</button>
      <button type="button" class="btn secondary small danger clear-cache">Clear saved answers</button>
    </div>
  </div>
  <small style="color: var(--muted); font-size: 10.5px">Shortcuts: Alt+M opens Mainkick, Alt+S summarizes highlighted text. Change them at chrome://extensions/shortcuts.</small>
</section>
`;

  // Clicks the AI may never auto-approve, even on an "always allow" site.
  const RISKY = /\b(buy|pay|payment|purchase|checkout|check out|order|delete|remove|erase|password|log ?out|sign ?out|unsubscribe|subscribe|transfer|send money|donate|confirm|submit|post|publish|send)\b/i;

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.documentElement.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  function downloadFile(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function plainText(markdown) {
    return String(markdown)
      .replace(/```[\s\S]*?```/g, ' (code block) ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/\|/g, ' ')
      .replace(/[*_~]{1,3}/g, '')
      .replace(/<br\s*\/?>/gi, ' ');
  }

  // ----- Read aloud (one voice at a time across the whole panel) -----
  let speakingBtn = null;
  function stopSpeaking() {
    try { speechSynthesis.cancel(); } catch (e) { /* not supported */ }
    if (speakingBtn) speakingBtn.textContent = speakingBtn.dataset.label;
    speakingBtn = null;
  }
  function speak(text, btn) {
    if (!('speechSynthesis' in window)) { btn.textContent = 'No voice available'; return; }
    const wasMe = speakingBtn === btn;
    stopSpeaking();
    if (wasMe) return;
    // Chrome cuts long utterances off, so read sentence-sized chunks one after another.
    const chunks = plainText(text).replace(/\s+/g, ' ').match(/[^.!?]{1,220}[.!?]*|\S.{0,219}/g) || [];
    if (!chunks.length) return;
    speakingBtn = btn;
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.textContent = '⏹ Stop';
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c.trim());
      if (i === chunks.length - 1) u.onend = () => { if (speakingBtn === btn) stopSpeaking(); };
      speechSynthesis.speak(u);
    });
  }

  function send(message) {
    return chrome.runtime.sendMessage(message).catch((e) => ({ ok: false, error: e.message }));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const today = () => new Date().toISOString().slice(0, 10);

  function create({ root, pageTools = null, onClose = null, embedded = false }) {
    const style = document.createElement('style');
    style.textContent = CSS;
    const panel = document.createElement('div');
    panel.className = 'panel' + (embedded ? ' embedded' : '');
    panel.innerHTML = HTML;
    root.append(style, panel);

    const $ = (sel) => panel.querySelector(sel);
    const log = $('.log');
    const thinking = $('.thinking');
    const input = $('.chat-input');
    const form = $('.input-row');
    const sendBtn = $('.send');
    const attach = $('.attach-cb');
    const settingsView = $('[data-view="settings"]');
    const status = $('.status');
    const activeEl = () => root.activeElement || document.activeElement;

    let settings = { ...MK.DEFAULTS };
    let renderedIds = [];
    let visible = false;
    let dirty = true;
    let refreshQueued = false;
    const pendingReplies = new Set(); // ids of messages this panel sent and is still waiting on

    $('#mk-model').value = MK.MODEL;

    // ----- Tabs -----
    function currentTab() {
      return panel.querySelector('.tab.active')?.dataset.tab;
    }
    function showTab(name) {
      panel.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      panel.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
      if (name === 'settings') { fillSettingsForm(); showUsage(); renderMemory(); renderSites(); }
      if (name === 'chat') input.focus();
      if (name === 'editor') loadDrafts().then(() => edText.focus());
    }
    panel.querySelectorAll('.tab').forEach((t) => { t.onclick = () => showTab(t.dataset.tab); });
    $('.close').onclick = () => { stopSpeaking(); onClose?.(); };
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && onClose) { stopSpeaking(); onClose(); } });

    // ----- Rendering the chat -----
    function welcomeEl() {
      const el = document.createElement('div');
      el.className = 'msg welcome';
      el.innerHTML = '<b>Mainkick is ready.</b><br>Ask anything, tick “Attach this page” to talk about it, ' +
        'or highlight text and right-click to summarize, explain or translate. Send answers to the ✎ Editor to make them your own.';
      return el;
    }

    function chip(text, onClick) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip' + (onClick ? '' : ' static');
      c.textContent = text;
      if (onClick) c.onclick = onClick;
      else c.tabIndex = -1;
      return c;
    }

    function actionBtn(label, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => onClick(b);
      return b;
    }

    const MODE_HEAD = { summarize: '✨ Summarize', explain: '❓ Explain', translate: '🌐 Translate' };

    function messageEl(m) {
      const el = document.createElement('div');
      if (m.role === 'user') {
        el.className = 'msg user';
        if (MODE_HEAD[m.mode]) {
          const head = document.createElement('span');
          head.className = 'head';
          head.textContent = MODE_HEAD[m.mode] + (m.mode === 'translate' && m.lang ? ` → ${m.lang}` : '');
          const quote = document.createElement('span');
          quote.className = 'quote';
          quote.textContent = `“${m.content.length > 160 ? m.content.slice(0, 160) + '…' : m.content}”`;
          el.append(head, quote);
          if (settings.imageSearch) {
            el.append(document.createElement('br'), chip('🖼️ Search images', () => send({ type: 'mk:images', query: m.content })));
          }
        } else {
          el.textContent = m.content;
          if (m.context) {
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.textContent = '\n🔗 page attached' + (m.clickable ? ' (with buttons)' : '');
            el.append(tag);
          }
        }
      } else if (m.role === 'assistant') {
        el.className = 'msg ai';
        if (m.content) el.innerHTML = md.render(m.content);

        const extras = document.createElement('div');
        for (const t of m.memories || []) extras.append(chip(`🧠 saved: ${t.length > 60 ? t.slice(0, 60) + '…' : t}`));
        for (const q of m.images || []) extras.append(chip(`🖼️ searched: ${q}`, () => send({ type: 'mk:images', query: q })));
        if (extras.childNodes.length) el.append(extras);

        const actions = document.createElement('div');
        actions.className = 'actions';
        if (m.content) {
          actions.append(
            actionBtn('📋 Copy', async (b) => {
              b.textContent = (await copyText(m.content)) ? '✓ Copied' : 'Copy failed';
              setTimeout(() => { b.textContent = '📋 Copy'; }, 1500);
            }),
            actionBtn('🔊 Read', (b) => speak(m.content, b)),
            actionBtn('✎ → Editor', () => sendToEditor(m.content))
          );
        }
        if (m.cached) {
          const badge = document.createElement('span');
          badge.textContent = '⚡ saved answer';
          actions.append(badge);
        }
        if (actions.childNodes.length) el.append(actions);
      } else {
        el.className = 'msg error';
        el.textContent = '⚠️ ' + m.content;
      }
      return el;
    }

    function renderChat(chat) {
      const msgs = chat.messages || [];
      const samePrefix = renderedIds.length <= msgs.length && renderedIds.every((id, i) => msgs[i].id === id);
      if (!samePrefix) {
        log.replaceChildren();
        renderedIds = [];
      }
      if (!msgs.length) {
        if (!log.firstChild) log.append(welcomeEl());
      } else if (!renderedIds.length) {
        log.replaceChildren();
      }

      // Only new messages are rendered, so a long chat never re-renders all at once.
      const added = msgs.length > renderedIds.length;
      for (let i = renderedIds.length; i < msgs.length; i++) {
        const m = msgs[i];
        log.append(messageEl(m));
        renderedIds.push(m.id);
        if (m.replyTo && pendingReplies.has(m.replyTo)) {
          pendingReplies.delete(m.replyTo);
          if (m.clicks?.length) runClicks(m.clicks);
        }
      }
      thinking.hidden = !(chat.busy > 0);
      if (added || !thinking.hidden) log.scrollTop = log.scrollHeight;
    }

    // Many storage events in a row collapse into one read + render.
    function refresh() {
      if (!visible) { dirty = true; return; }
      if (refreshQueued) return;
      refreshQueued = true;
      setTimeout(async () => {
        refreshQueued = false;
        dirty = false;
        renderChat(await MK.loadChat(settings));
      }, 0);
    }

    // ----- AI clicks: always shown, risky ones always asked -----
    function card(text) {
      const el = document.createElement('div');
      el.className = 'card';
      el.textContent = text;
      log.append(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }

    function askClick(info, risky) {
      return new Promise((resolve) => {
        const el = card(`🖱️ The AI wants to click ${info.kind} “${info.label}”.`);
        if (risky) {
          const w = document.createElement('span');
          w.className = 'warn';
          w.textContent = 'This looks like it could buy, send, delete or sign out. Check before allowing.';
          el.append(w);
        }
        const row = document.createElement('div');
        row.className = 'card-row';
        const done = (choice, text) => { row.remove(); el.classList.add('done'); el.textContent = text; resolve(choice); };
        const allow = document.createElement('button');
        allow.type = 'button';
        allow.className = 'btn small';
        allow.textContent = 'Allow';
        allow.onclick = () => done('allow', `🖱️ Clicked “${info.label}”.`);
        const deny = document.createElement('button');
        deny.type = 'button';
        deny.className = 'btn secondary small';
        deny.textContent = 'Deny';
        deny.onclick = () => done('deny', `🚫 Didn't click “${info.label}”.`);
        row.append(allow, deny);
        if (!risky) {
          const always = document.createElement('button');
          always.type = 'button';
          always.className = 'btn secondary small';
          always.textContent = `Always on ${pageTools.site()}`;
          always.onclick = () => done('always', `🖱️ Clicked “${info.label}”. Clicks on ${pageTools.site()} are now always allowed.`);
          row.append(always);
        }
        el.append(row);
        allow.focus();
      });
    }

    async function runClicks(numbers) {
      if (!pageTools || !settings.aiClick) return;
      for (const n of numbers) {
        const info = pageTools.describe(n);
        if (!info) { card(`⚠️ The AI asked to click #${n}, but that isn't on this page's list.`).classList.add('done'); continue; }
        if (!info.alive) { card(`⚠️ “${info.label}” is no longer on the page.`).classList.add('done'); continue; }
        const site = pageTools.site();
        const risky = RISKY.test(info.label) || info.kind === 'submit';
        let choice = !risky && (settings.clickSites || []).includes(site) ? 'auto' : await askClick(info, risky);
        if (choice === 'deny') break;
        if (choice === 'always') {
          const s = await MK.getSettings();
          const sites = [...new Set([...(s.clickSites || []), site])];
          await chrome.storage.local.set({ [KEYS.settings]: { ...s, clickSites: sites } });
        }
        const res = pageTools.click(n);
        if (choice === 'auto') card(res.ok ? `🖱️ Clicked “${info.label}” (always allowed here).` : `⚠️ ${res.error}`).classList.add('done');
        else if (!res.ok) card(`⚠️ ${res.error}`).classList.add('done');
        await sleep(700);
      }
    }

    // ----- Settings -----
    function applySettings(next) {
      settings = { ...MK.DEFAULTS, ...(next || {}) };
      renderPresets();
      $('.attach-label').textContent = settings.aiClick ? '🔗 Attach this page (+ buttons for AI clicks)' : '🔗 Attach this page';
    }

    function fillSettingsForm() {
      settingsView.querySelectorAll('[name]').forEach((f) => {
        if (f.type === 'checkbox') f.checked = !!settings[f.name];
        else f.value = settings[f.name] ?? '';
      });
    }

    async function showUsage() {
      try {
        const bytes = await chrome.storage.local.getBytesInUse(null);
        $('.usage').textContent = `Settings, drafts, memory and saved answers use ${(bytes / 1024).toFixed(1)} KB of this browser's extension storage.`;
      } catch (e) {
        $('.usage').textContent = '';
      }
    }

    function flash(text) {
      status.textContent = text;
      setTimeout(() => { if (status.textContent === text) status.textContent = ''; }, 2200);
    }

    $('.save').onclick = async () => {
      const next = { ...(await MK.getSettings()) };
      settingsView.querySelectorAll('[name]').forEach((f) => {
        if (f.type === 'checkbox') next[f.name] = f.checked;
        else if (f.hasAttribute('data-number')) next[f.name] = Number(f.value);
        else if (f.name === 'presets') next[f.name] = f.value;
        else next[f.name] = f.value.trim();
      });
      await chrome.storage.local.set({ [KEYS.settings]: next });
      applySettings(next);
      flash('Settings saved ✓');
      showUsage();
    };

    $('.reveal').onclick = () => {
      const key = $('#mk-key');
      key.type = key.type === 'password' ? 'text' : 'password';
    };

    // Two-click confirmation for buttons that throw things away.
    function confirmTwice(btn, action) {
      const label = btn.textContent;
      let armed = false;
      let timer;
      btn.onclick = async () => {
        if (!armed) {
          armed = true;
          btn.textContent = 'Sure? Click again';
          timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000);
          return;
        }
        clearTimeout(timer);
        armed = false;
        btn.textContent = label;
        await action();
      };
    }

    confirmTwice($('.clear-chat'), async () => { await send({ type: 'mk:clearChat' }); flash('Chat cleared'); });
    confirmTwice($('.clear-cache'), async () => { await send({ type: 'mk:clearCache' }); flash('Saved answers cleared'); showUsage(); });

    $('.export-chat').onclick = async () => {
      const chat = await MK.loadChat(settings);
      const lines = [`# Mainkick chat (${today()})`, ''];
      for (const m of chat.messages) {
        if (m.role === 'user') {
          lines.push(MODE_HEAD[m.mode] ? `## You (${MODE_HEAD[m.mode].slice(2)})` : '## You', '', MODE_HEAD[m.mode] ? `> ${m.content.replace(/\n/g, '\n> ')}` : m.content, '');
        } else if (m.role === 'assistant') {
          lines.push('## Mainkick', '', m.content || '_(no text)_', '');
        } else {
          lines.push(`_⚠️ ${m.content}_`, '');
        }
      }
      if (!chat.messages.length) { flash('The chat is empty'); return; }
      downloadFile(`mainkick-chat-${today()}.md`, lines.join('\n'), 'text/markdown');
      flash('Chat exported ✓');
    };

    // ----- Memory list -----
    async function renderMemory() {
      const list = $('.mem-list');
      const mem = await MK.loadMemory();
      if (activeEl()?.closest?.('.mem-list')) return; // don't yank the field the user is editing
      list.replaceChildren(...mem.slice().reverse().map((m) => {
        const row = document.createElement('div');
        row.className = 'list-item';
        const field = document.createElement('input');
        field.type = 'text';
        field.value = m.text;
        field.maxLength = MK.MEMORY_ITEM_MAX;
        field.title = 'Edit, then press Enter or click away to save';
        field.onchange = () => {
          const text = field.value.trim();
          send(text ? { type: 'mk:memory', op: 'update', id: m.id, text } : { type: 'mk:memory', op: 'delete', id: m.id });
        };
        field.onkeydown = (e) => { if (e.key === 'Enter') field.blur(); };
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'icon-btn';
        del.title = 'Forget this';
        del.textContent = '✕';
        del.onclick = () => send({ type: 'mk:memory', op: 'delete', id: m.id });
        row.append(field, del);
        return row;
      }));
    }

    $('.mem-add').onsubmit = async (e) => {
      e.preventDefault();
      const field = $('.mem-input');
      const text = field.value.trim();
      if (!text) return;
      field.value = '';
      await send({ type: 'mk:memory', op: 'add', text });
    };
    confirmTwice($('.mem-clear'), async () => { await send({ type: 'mk:memory', op: 'clear' }); flash('Memory cleared'); });

    function renderSites() {
      $('.site-list').replaceChildren(...(settings.clickSites || []).map((site) => {
        const row = document.createElement('div');
        row.className = 'list-item';
        const name = document.createElement('span');
        name.className = 'site';
        name.textContent = site;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn secondary small';
        del.textContent = 'Remove';
        del.onclick = async () => {
          const s = await MK.getSettings();
          await chrome.storage.local.set({ [KEYS.settings]: { ...s, clickSites: (s.clickSites || []).filter((x) => x !== site) } });
        };
        row.append(name, del);
        return row;
      }));
    }

    // ----- Quick prompts -----
    function renderPresets() {
      const box = $('.presets');
      box.replaceChildren(...MK.parsePresets(settings.presets).map((p) =>
        chip(p.label, () => {
          const text = input.value.trim();
          if (text || attach.checked) {
            submit(`${p.prompt}\n\n${text || '(the attached webpage)'}`);
          } else {
            input.value = p.prompt + ' ';
            autosize();
            input.focus();
          }
        })
      ));
      for (const c of box.children) c.title = 'Uses what you typed, or the attached page';
    }

    // ----- Sending -----
    async function submit(override) {
      const text = (override ?? input.value).trim();
      if (!text) return;
      if (!settings.apiKey) {
        showTab('settings');
        flash('Add your API key first');
        $('#mk-key').focus();
        return;
      }
      input.value = '';
      autosize();
      sendBtn.disabled = true;
      let context = '';
      let clickable = false;
      if (attach.checked && pageTools) {
        const ctx = pageTools.getContext(settings.contextChars, settings.aiClick);
        context = ctx.text;
        clickable = ctx.clickable;
        attach.checked = false;
      }
      const id = crypto.randomUUID();
      pendingReplies.add(id);
      const res = await send({ type: 'mk:send', mode: 'chat', text, context, clickable, id });
      sendBtn.disabled = false;
      if (res && res.ok === false) {
        pendingReplies.delete(id);
        log.append(messageEl({ role: 'error', content: `Couldn't reach the extension (${res.error}). Try reloading the page.` }));
      }
    }

    function autosize() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    }

    form.onsubmit = (e) => { e.preventDefault(); submit(); };
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    $('.img-btn').onclick = () => {
      const q = input.value.trim() || String(window.getSelection?.() || '').trim();
      if (q) send({ type: 'mk:images', query: q });
      else input.focus();
    };

    // ----- Editor (drafts saved in local storage) -----
    const edText = $('.ed-text');
    const edSelect = $('.ed-drafts');
    const edStatus = $('.ed-status');
    const MAX_DRAFTS = 20;
    let drafts = { active: null, list: [] };
    let saveTimer = null;

    const newDraft = (text = '') => ({ id: crypto.randomUUID(), text, updated: Date.now() });
    const activeDraft = () => drafts.list.find((d) => d.id === drafts.active);
    function draftTitle(d) {
      const first = (d.text.split('\n').find((l) => l.trim()) || '').replace(/^[#>*\-\s]+/, '').trim();
      return first ? (first.length > 34 ? first.slice(0, 34) + '…' : first) : 'Untitled draft';
    }

    function normalizeDrafts(raw) {
      const list = Array.isArray(raw?.list) ? raw.list.filter((d) => d && d.id) : [];
      if (!list.length) list.push(newDraft());
      const active = list.some((d) => d.id === raw?.active) ? raw.active : list[0].id;
      return { active, list };
    }

    async function loadDrafts() {
      const r = await chrome.storage.local.get(KEYS.drafts);
      drafts = normalizeDrafts(r[KEYS.drafts]);
      renderEditor();
    }

    function saveDraftsSoon() {
      clearTimeout(saveTimer);
      $('.ed-saved').textContent = 'saving…';
      saveTimer = setTimeout(saveDraftsNow, 400);
    }
    async function saveDraftsNow() {
      clearTimeout(saveTimer);
      saveTimer = null;
      await chrome.storage.local.set({ [KEYS.drafts]: drafts });
      $('.ed-saved').textContent = 'saved ✓';
    }

    function renderDraftList() {
      const sorted = drafts.list.slice().sort((a, b) => b.updated - a.updated);
      edSelect.replaceChildren(...sorted.map((d) => {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = draftTitle(d);
        return o;
      }));
      edSelect.value = drafts.active;
    }

    function renderCounts() {
      const t = edText.value;
      const words = (t.match(/\S+/g) || []).length;
      $('.ed-counts').textContent = `${words} word${words === 1 ? '' : 's'} · ${t.length} character${t.length === 1 ? '' : 's'}`;
    }

    function renderEditor() {
      renderDraftList();
      const d = activeDraft();
      if (edText.value !== d.text) edText.value = d.text;
      renderCounts();
    }

    function edFlash(text, bad = false) {
      edStatus.textContent = text;
      edStatus.classList.toggle('bad', bad);
      setTimeout(() => { if (edStatus.textContent === text) edStatus.textContent = ''; }, 3000);
    }

    edText.addEventListener('input', () => {
      const d = activeDraft();
      d.text = edText.value;
      d.updated = Date.now();
      renderCounts();
      const opt = edSelect.querySelector(`option[value="${d.id}"]`);
      if (opt) opt.textContent = draftTitle(d);
      saveDraftsSoon();
    });

    edSelect.onchange = async () => {
      if (saveTimer) await saveDraftsNow();
      drafts.active = edSelect.value;
      await saveDraftsNow();
      renderEditor();
    };

    $('.ed-new').onclick = async () => {
      if (saveTimer) await saveDraftsNow();
      const d = newDraft();
      drafts.list.push(d);
      // Keep the newest drafts; the oldest ones go first.
      drafts.list = drafts.list.sort((a, b) => b.updated - a.updated).slice(0, MAX_DRAFTS);
      drafts.active = d.id;
      await saveDraftsNow();
      renderEditor();
      edText.focus();
    };

    confirmTwice($('.ed-delete'), async () => {
      drafts.list = drafts.list.filter((d) => d.id !== drafts.active);
      drafts = normalizeDrafts({ list: drafts.list });
      await saveDraftsNow();
      renderEditor();
      edFlash('Draft deleted');
    });

    confirmTwice($('.ed-clear'), async () => {
      const d = activeDraft();
      d.text = '';
      d.updated = Date.now();
      await saveDraftsNow();
      renderEditor();
      edText.focus();
    });

    $('.ed-copy').onclick = async () => {
      if (!edText.value) return edFlash('Nothing to copy yet', true);
      edFlash((await copyText(edText.value)) ? 'Copied to clipboard ✓' : 'Copy failed', false);
    };
    $('.ed-read').onclick = () => { if (edText.value.trim()) speak(edText.value, $('.ed-read')); };
    const fileBase = () => (draftTitle(activeDraft()).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'draft');
    $('.ed-txt').onclick = () => {
      if (!edText.value) return edFlash('Nothing to download yet', true);
      downloadFile(`${fileBase()}.txt`, edText.value, 'text/plain');
    };
    $('.ed-md').onclick = () => {
      if (!edText.value) return edFlash('Nothing to download yet', true);
      downloadFile(`${fileBase()}.md`, edText.value, 'text/markdown');
    };
    $('.ed-insert').onclick = () => {
      if (!pageTools) return;
      if (!edText.value) return edFlash('The draft is empty', true);
      const res = pageTools.insertText(edText.value);
      edFlash(res.ok ? 'Inserted into the page ✓' : res.error, !res.ok);
    };

    async function sendToEditor(text) {
      const r = await chrome.storage.local.get(KEYS.drafts);
      drafts = normalizeDrafts(r[KEYS.drafts]);
      const d = activeDraft();
      d.text = d.text.trim() ? `${d.text.replace(/\s+$/, '')}\n\n${text}` : text;
      d.updated = Date.now();
      await saveDraftsNow();
      showTab('editor');
      renderEditor();
      edText.scrollTop = edText.scrollHeight;
      edFlash('Added to your draft ✓');
    }

    // ----- Storage sync -----
    function onStorage(changes) {
      if (changes[KEYS.settings]) {
        applySettings(changes[KEYS.settings].newValue);
        if (currentTab() === 'settings') { fillSettingsForm(); renderSites(); }
      }
      if (changes[KEYS.chat]) refresh();
      if (changes[KEYS.memory] && currentTab() === 'settings') renderMemory();
      if (changes[KEYS.drafts] && !saveTimer && activeEl() !== edText) {
        drafts = normalizeDrafts(changes[KEYS.drafts].newValue);
        renderEditor();
      }
    }
    chrome.storage.onChanged.addListener(onStorage);

    MK.getSettings().then((s) => { applySettings(s); refresh(); });
    drafts = normalizeDrafts(null); // placeholder until the saved drafts load
    loadDrafts();

    return {
      dragHandle: $('.nav'),
      setVisible(v) {
        visible = v;
        if (v) {
          if (dirty) refresh();
          if (currentTab() === 'chat') setTimeout(() => input.focus(), 0);
        } else {
          stopSpeaking();
          if (saveTimer) saveDraftsNow();
        }
      },
      destroy() {
        stopSpeaking();
        chrome.storage.onChanged.removeListener(onStorage);
        style.remove();
        panel.remove();
      }
    };
  }

  window.MainkickPanel = { create };
})();
