importScripts('shared.js');

const { KEYS, PANEL_FILES, MODEL } = MK;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MIN_GAP_MS = 1200;        // never start two API calls closer together than this
const TIMEOUT_MS = 60000;       // give up on a request after a minute instead of hanging forever
const MAX_STORED = 60;          // messages kept in the saved chat
const MAX_SELECTION = 12000;    // characters of highlighted text sent per request
const CACHE_MAX = 40;           // saved summaries/explanations/translations
const MAX_IMAGE_TABS = 3;       // image searches the AI may open per answer
const MAX_CLICKS = 3;           // clicks the AI may ask for per answer

const BASE_PROMPT = 'You are Mainkick, a helpful, concise assistant inside a browser extension. Format answers in Markdown.';

// Let the page panel (a content script) read the session-only chat.
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});

const uid = () => crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Chat state (every write goes through this lock, so writes never clobber each other) ----------

let chatLock = Promise.resolve();
function updateChat(mutate) {
  const run = chatLock.then(async () => {
    const s = await MK.getSettings();
    const chat = await MK.loadChat(s);
    mutate(chat);
    chat.messages = chat.messages.slice(-MAX_STORED);
    await MK.chatArea(s).set({ [KEYS.chat]: chat });
    return chat;
  });
  chatLock = run.catch(() => {});
  return run;
}

// If the worker restarted mid-request, that request is gone: clear any stuck "Thinking…" state.
updateChat((c) => { c.busy = 0; });

// ---------- AI memory (also behind a lock) ----------

let memoryLock = Promise.resolve();
function updateMemory(mutate) {
  const run = memoryLock.then(async () => {
    const list = await MK.loadMemory();
    const next = mutate(list) || list;
    const clean = next
      .map((m) => ({ id: m.id || uid(), text: String(m.text || '').trim().slice(0, MK.MEMORY_ITEM_MAX), ts: m.ts || Date.now() }))
      .filter((m) => m.text)
      .slice(-MK.MEMORY_MAX);
    await chrome.storage.local.set({ [KEYS.memory]: clean });
    return clean;
  });
  memoryLock = run.catch(() => {});
  return run;
}

// ---------- API queue: one request at a time, spaced out, with a timeout ----------

let apiQueue = Promise.resolve();
function enqueue(task) {
  const run = apiQueue.then(task, task);
  apiQueue = run.catch(() => {});
  return run;
}

let lastCall = 0;
async function callGroq(messages, s) {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({ model: MODEL, messages })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) throw new Error('Your API key was rejected. Check it in ⚙️ Settings.');
      if (res.status === 429) {
        const after = res.headers.get('retry-after');
        throw new Error(`Rate limit reached. Wait ${after ? after + ' seconds' : 'a moment'} and try again.`);
      }
      throw new Error(data?.error?.message || `The API answered with error ${res.status}.`);
    }
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('The AI sent back an empty answer.');
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The AI took longer than a minute to answer. Try again.');
    if (e instanceof TypeError) throw new Error(`Network error: ${e.message}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Cache for one-shot answers ----------

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cacheGet(key) {
  const c = (await chrome.storage.local.get(KEYS.cache))[KEYS.cache] || {};
  return c[key]?.v;
}

async function cachePut(key, value) {
  const c = (await chrome.storage.local.get(KEYS.cache))[KEYS.cache] || {};
  c[key] = { v: value, t: Date.now() };
  const newestFirst = Object.keys(c).sort((a, b) => c[b].t - c[a].t);
  for (const old of newestFirst.slice(CACHE_MAX)) delete c[old];
  await chrome.storage.local.set({ [KEYS.cache]: c });
}

// ---------- Building requests ----------

const SUMMARY_STYLES = {
  bullets: 'Provide a crisp, bulleted summary of this selected text',
  paragraph: 'Summarize this selected text in one short paragraph',
  tldr: 'Give a one- or two-sentence TL;DR of this selected text'
};

const ONE_SHOT = ['summarize', 'explain', 'translate'];

function apiContent(m, s) {
  if (m.mode === 'summarize') {
    return `${SUMMARY_STYLES[s.summaryStyle] || SUMMARY_STYLES.bullets}:\n\n"${m.content}"`;
  }
  if (m.mode === 'explain') {
    return `Explain this selected text, or answer it if it is a question:\n\n"${m.content}"`;
  }
  if (m.mode === 'translate') {
    return `Translate this text into ${m.lang || s.translateTo}. Reply with only the translation:\n\n"${m.content}"`;
  }
  return m.content;
}

// The chat system prompt describes only the tools that are switched on.
async function chatSystemPrompt(s, withClicks) {
  const parts = [BASE_PROMPT];

  if (s.aiMemory) {
    const mem = await MK.loadMemory();
    parts.push(
      'You have a long-term memory that lasts between chats. When the user tells you something worth remembering ' +
      'later (their name, preferences, ongoing projects, how they like answers), save it by writing ' +
      '<remember>one short fact</remember> anywhere in your reply. The tag is hidden from the user. Save sparingly, ' +
      'never save passwords, keys or other secrets, and do not save things already in memory.' +
      (mem.length
        ? '\nWhat you remember about the user:\n' + mem.map((m) => '- ' + m.text).join('\n')
        : '\nYour memory is currently empty.')
    );
  }

  if (s.aiImageSearch) {
    parts.push(
      'You can open a Google Images search for the user by writing <searchimg your search terms> in your reply. ' +
      `Use it when the user asks for pictures or when images would clearly help, at most ${MAX_IMAGE_TABS} per reply.`
    );
  }

  if (withClicks) {
    parts.push(
      'The webpage context ends with a numbered list of clickable elements. If, and only if, the user asks you to ' +
      'click or press something on the page, write <click N> with that element\'s number (one tag per click, at ' +
      `most ${MAX_CLICKS}). The user is asked to confirm first. Say briefly what you are clicking.`
    );
  }

  return parts.join('\n\n');
}

async function buildHistory(user, s) {
  const chat = await MK.loadChat(s);
  const end = chat.messages.findIndex((m) => m.id === user.id);
  const past = chat.messages
    .slice(0, end === -1 ? undefined : end + 1)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-s.historyMessages);
  if (end === -1) past.push(user);

  // Only the most recent attached page text is sent, so old attachments don't bloat every request.
  let lastWithContext = -1;
  past.forEach((m, i) => { if (m.context) lastWithContext = i; });
  const withClicks = s.aiClick && lastWithContext !== -1 && !!past[lastWithContext].clickable &&
    past[lastWithContext].id === user.id;

  return [
    { role: 'system', content: await chatSystemPrompt(s, withClicks) },
    ...past.map((m, i) => ({
      role: m.role,
      content: i === lastWithContext
        ? `[Webpage context]\n${m.context}\n[/Webpage context]\n\n${apiContent(m, s)}`
        : apiContent(m, s)
    }))
  ];
}

// Pull the tool tags out of an answer. Tags inside ``` code blocks are left alone.
function extractTags(text) {
  const found = { memories: [], images: [], clicks: [] };
  const parts = String(text).split(/(```[\s\S]*?(?:```|$))/);
  const cleaned = parts.map((part, i) => {
    if (i % 2 === 1) return part; // code block
    return part
      .replace(/<remember>([\s\S]*?)<\/remember>/gi, (_, t) => { found.memories.push(t.trim()); return ''; })
      .replace(/<searchimg\s+([^<>]{1,200})>(?:\s*<\/searchimg>)?/gi, (_, q) => { found.images.push(q.trim()); return ''; })
      .replace(/<click\s*(\d{1,4})\s*\/?>(?:\s*<\/click>)?/gi, (_, n) => { found.clicks.push(Number(n)); return ''; })
      .replace(/(\S)[ \t]{2,}/g, '$1 '); // spaces left behind by removed tags
  }).join('');
  return { ...found, content: cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() };
}

async function respond(user, s) {
  if (!s.apiKey) throw new Error('No API key yet. Open ⚙️ Settings and paste your Groq key.');

  const oneShot = ONE_SHOT.includes(user.mode);
  const messages = oneShot
    ? [{ role: 'system', content: BASE_PROMPT }, { role: 'user', content: apiContent(user, s) }]
    : await buildHistory(user, s);

  const key = oneShot && s.cacheResults ? await sha256(JSON.stringify([MODEL, messages])) : null;
  if (key) {
    const hit = await cacheGet(key);
    if (hit) return { role: 'assistant', content: hit, cached: true };
  }

  const raw = await callGroq(messages, s);
  if (oneShot) {
    if (key) await cachePut(key, raw);
    return { role: 'assistant', content: raw };
  }

  const tags = extractTags(raw);
  const reply = { role: 'assistant', content: tags.content };

  if (s.aiMemory && tags.memories.length) {
    const saved = tags.memories.map((t) => t.slice(0, MK.MEMORY_ITEM_MAX)).filter(Boolean);
    await updateMemory((list) => {
      const have = new Set(list.map((m) => m.text.toLowerCase()));
      for (const text of saved) if (!have.has(text.toLowerCase())) list.push({ text, ts: Date.now() });
      return list;
    });
    reply.memories = saved;
  }
  if (s.aiImageSearch && tags.images.length) reply.images = tags.images.slice(0, MAX_IMAGE_TABS);
  if (s.aiClick && user.clickable && tags.clicks.length) reply.clicks = tags.clicks.slice(0, MAX_CLICKS);
  if (!reply.content && !reply.memories && !reply.images && !reply.clicks) {
    throw new Error('The AI sent back an empty answer.');
  }
  return reply;
}

async function handleSend({ mode = 'chat', text = '', context = '', clickable = false, id }, tab) {
  if (!['chat', ...ONE_SHOT].includes(mode)) mode = 'chat';
  text = String(text).trim().slice(0, mode === 'chat' ? 8000 : MAX_SELECTION);
  if (!text) return;

  const s = await MK.getSettings();
  const user = {
    id: typeof id === 'string' && /^[\w-]{8,64}$/.test(id) ? id : uid(),
    role: 'user', mode, content: text, ts: Date.now()
  };
  if (mode === 'translate') user.lang = s.translateTo;
  if (context) {
    user.context = String(context).slice(0, 24000);
    if (clickable) user.clickable = true;
  }

  let epoch;
  await updateChat((c) => {
    c.messages.push(user);
    c.busy = (c.busy || 0) + 1;
    epoch = c.epoch || 0;
  });

  enqueue(async () => {
    let reply;
    try {
      reply = await respond(user, await MK.getSettings());
    } catch (e) {
      reply = { role: 'error', content: e.message };
    }
    let kept = false;
    await updateChat((c) => {
      c.busy = Math.max(0, (c.busy || 0) - 1);
      if ((c.epoch || 0) !== epoch) return; // chat was cleared while this was running
      c.messages.push({ id: uid(), ts: Date.now(), replyTo: user.id, ...reply });
      kept = true;
    });
    if (kept && reply.images) {
      for (const q of reply.images) await openImages(q, tab, false);
    }
  });
  return user.id;
}

// ---------- Panel + image search ----------

async function showPanel(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: PANEL_FILES });
    await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__Mainkick.open() });
    return true;
  } catch (e) {
    return false; // chrome:// pages, the Web Store, etc. don't allow injection
  }
}

async function openImages(query, tab, active = true) {
  if (!String(query || '').trim()) return;
  const url = MK.imageSearchUrl(query);
  try {
    await chrome.tabs.create({ url, active, ...(tab ? { index: tab.index + 1, openerTabId: tab.id } : {}) });
  } catch (e) {
    await chrome.tabs.create({ url, active }).catch(() => {}); // the original tab was closed
  }
}

// ---------- Right-click menu ----------

let menuLock = Promise.resolve();
function buildMenus() {
  menuLock = menuLock.then(async () => {
    const s = await MK.getSettings();
    await chrome.contextMenus.removeAll();
    const add = (id, title) =>
      chrome.contextMenus.create({ id, title, contexts: ['selection'] }, () => void chrome.runtime.lastError);
    add('mk-summarize', '✨ Summarize text');
    add('mk-explain', '❓ Ask about text');
    add('mk-translate', `🌐 Translate to ${s.translateTo}`);
    if (s.imageSearch) add('mk-images', '🖼️ Search Google Images for "%s"');
  }).catch(() => {});
  return menuLock;
}

chrome.runtime.onInstalled.addListener(() => buildMenus());
chrome.runtime.onStartup.addListener(() => buildMenus());

const MENU_MODES = { 'mk-summarize': 'summarize', 'mk-explain': 'explain', 'mk-translate': 'translate' };

async function runOnSelection(mode, text, tab) {
  await handleSend({ mode, text }, tab);
  const shown = tab?.id >= 0 && (await showPanel(tab.id));
  if (!shown) {
    // Can't draw on this page: the answer still lands in the chat, so point the user at the toolbar popup.
    chrome.action.setBadgeBackgroundColor({ color: '#00c853' });
    chrome.action.setBadgeText({ text: '1' });
    chrome.action.openPopup?.().catch(() => {});
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const text = (info.selectionText || '').trim();
  if (!text) return;
  if (info.menuItemId === 'mk-images') return openImages(text, tab);
  const mode = MENU_MODES[info.menuItemId];
  if (mode) await runOnSelection(mode, text, tab);
});

// ---------- Keyboard shortcut: summarize the highlighted text ----------

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'summarize-selection') return;
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!(tab?.id >= 0)) return;
  let text = '';
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection?.() || '')
    });
    text = String(res?.result || '').trim();
  } catch (e) { /* protected page */ }
  if (text) await runOnSelection('summarize', text, tab);
  else await showPanel(tab.id);
});

// ---------- Messages from the panel/popup ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'mk:send':
      handleSend(msg, sender.tab).then(
        (id) => sendResponse({ ok: true, id }),
        (e) => sendResponse({ ok: false, error: e.message })
      );
      return true;
    case 'mk:images':
      openImages(msg.query, sender.tab);
      return false;
    case 'mk:clearChat':
      updateChat((c) => { c.messages = []; c.epoch = (c.epoch || 0) + 1; }).then(() => sendResponse({ ok: true }));
      return true;
    case 'mk:clearCache':
      chrome.storage.local.remove(KEYS.cache).then(() => sendResponse({ ok: true }));
      return true;
    case 'mk:memory': {
      const { op, id, text } = msg;
      updateMemory((list) => {
        if (op === 'add' && text) list.push({ text, ts: Date.now() });
        if (op === 'update') { const m = list.find((x) => x.id === id); if (m) m.text = text; }
        if (op === 'delete') return list.filter((x) => x.id !== id);
        if (op === 'clear') return [];
        return list;
      }).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  }
  return false;
});

// ---------- React to settings changes ----------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[KEYS.settings]) return;
  const before = { ...MK.DEFAULTS, ...(changes[KEYS.settings].oldValue || {}) };
  const after = { ...MK.DEFAULTS, ...(changes[KEYS.settings].newValue || {}) };

  if (before.imageSearch !== after.imageSearch || before.translateTo !== after.translateTo) buildMenus();

  if (before.rememberChats !== after.rememberChats) {
    // Move the chat to the storage area that matches the new setting.
    chatLock = chatLock.then(async () => {
      const from = MK.chatArea(before);
      const to = MK.chatArea(after);
      const r = await from.get(KEYS.chat);
      if (r[KEYS.chat]) {
        await to.set(r);
        await from.remove(KEYS.chat);
      }
    }).catch(() => {});
  }
});
