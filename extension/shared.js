// Shared constants and storage helpers, loaded by the background worker, the popup and the page panel.
(() => {
  const g = typeof window !== 'undefined' ? window : self;
  if (g.MK) return;

  // The model is fixed: every request uses this one, whatever is in storage.
  const MODEL = 'openai/gpt-oss-120b';

  const DEFAULT_PRESETS = [
    'Explain like I\'m 12 | Explain this simply, like I\'m 12 years old:',
    'Translate | Translate this into French:',
    'Flashcards | Turn this into 5–10 question/answer flashcards:',
    'Key terms | List the key terms in this, each with a one-line definition:'
  ].join('\n');

  const DEFAULTS = {
    apiKey: '',
    summaryStyle: 'bullets',   // bullets | paragraph | tldr
    translateTo: 'English',    // language for the right-click "Translate" item
    contextChars: 6000,        // how much page text "Attach page" sends
    historyMessages: 10,       // how many past messages each chat request includes
    rememberChats: false,      // false: chat lasts until the browser closes; true: kept forever
    cacheResults: true,        // reuse answers for text that was already summarized/explained
    imageSearch: true,         // show "Search Google Images" in the right-click menu
    aiMemory: true,            // the AI may save notes with <remember>…</remember>
    aiImageSearch: true,       // the AI may open image searches with <searchimg …>
    aiClick: false,            // the AI may click page elements with <click N> (asks first)
    clickSites: [],            // sites where the user chose "always allow" for AI clicks
    presets: DEFAULT_PRESETS   // one per line: "Label | prompt"
  };

  const KEYS = {
    settings: 'mk_settings',
    chat: 'mk_chat',
    cache: 'mk_cache',
    memory: 'mk_memory',
    drafts: 'mk_drafts'
  };
  const PANEL_FILES = ['shared.js', 'markdown.js', 'panel.js', 'content.js'];
  const MEMORY_MAX = 50;
  const MEMORY_ITEM_MAX = 300;

  async function getSettings() {
    const r = await chrome.storage.local.get(KEYS.settings);
    return { ...DEFAULTS, ...(r[KEYS.settings] || {}) };
  }

  function chatArea(settings) {
    return settings.rememberChats ? chrome.storage.local : chrome.storage.session;
  }

  async function loadChat(settings) {
    try {
      const s = settings || await getSettings();
      const r = await chatArea(s).get(KEYS.chat);
      return r[KEYS.chat] || { messages: [], busy: 0, epoch: 0 };
    } catch (e) {
      return { messages: [], busy: 0, epoch: 0 };
    }
  }

  async function loadMemory() {
    const r = await chrome.storage.local.get(KEYS.memory);
    return Array.isArray(r[KEYS.memory]) ? r[KEYS.memory] : [];
  }

  function parsePresets(text) {
    return String(text || '')
      .split('\n')
      .map((line) => {
        const i = line.indexOf('|');
        if (i === -1) return null;
        const label = line.slice(0, i).trim();
        const prompt = line.slice(i + 1).trim();
        return label && prompt ? { label: label.slice(0, 24), prompt } : null;
      })
      .filter(Boolean)
      .slice(0, 8);
  }

  function imageSearchUrl(query) {
    return 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(String(query).trim().slice(0, 200));
  }

  g.MK = {
    MODEL, DEFAULTS, KEYS, PANEL_FILES, MEMORY_MAX, MEMORY_ITEM_MAX,
    getSettings, chatArea, loadChat, loadMemory, parsePresets, imageSearchUrl
  };
})();
