// The toolbar button opens the on-page panel, which stays open when you click elsewhere.
// Only on pages the browser protects (chrome://, the Web Store…) does Mainkick show here in the popup instead.
(async () => {
  chrome.action.setBadgeText({ text: '' });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    if (!(tab?.id >= 0)) throw new Error('no tab');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: MK.PANEL_FILES });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__Mainkick.toggle() });
    window.close();
    return;
  } catch (e) {
    // Fall through to the popup.
  }

  document.body.classList.add('fallback');
  const panel = MainkickPanel.create({ root: document.getElementById('app'), embedded: true });
  panel.setVisible(true);
})();
