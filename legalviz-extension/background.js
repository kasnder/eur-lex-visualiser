/* global chrome */

const LOCALHOST_URL = 'http://localhost:5173';
const PRODUCTION_URL = 'https://legalviz.eu';
const COLOR_ICONS = {
  16: 'icon16.png',
  48: 'icon48.png',
  128: 'icon128.png',
};
const GREY_ICONS = {
  16: 'icon16-grey.png',
  48: 'icon48-grey.png',
  128: 'icon128-grey.png',
};

function isSupportedEurlexPage(urlString) {
  if (!urlString) return false;

  try {
    const url = new URL(urlString);
    if (url.hostname !== 'eur-lex.europa.eu') return false;
    return url.pathname.includes('/legal-content/') || url.pathname.includes('/eli/');
  } catch {
    return false;
  }
}

async function detectBaseUrl() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 800);

    const response = await fetch(LOCALHOST_URL, {
      method: 'GET',
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeoutId);

    if (response?.ok) {
      const text = await response.text();
      if (text.includes('<title>LegalViz.EU</title>')) {
        return LOCALHOST_URL;
      }
    }
  } catch {
    // Ignore and fall back to production.
  }

  return PRODUCTION_URL;
}

async function openInLegalViz(tab) {
  const pageUrl = tab?.url || '';
  if (!isSupportedEurlexPage(pageUrl)) {
    return;
  }

  const baseUrl = await detectBaseUrl();
  const targetUrl = new URL('/import', baseUrl);
  targetUrl.searchParams.set('sourceUrl', pageUrl);

  chrome.tabs.create({ url: targetUrl.toString() });
}

async function updateIconState(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const supported = isSupportedEurlexPage(tab?.url || '');

    chrome.action.setIcon({
      tabId,
      path: supported ? COLOR_ICONS : GREY_ICONS,
    });

    chrome.action.setTitle({
      tabId,
      title: supported
        ? 'LegalViz.EU - Click to open this EUR-Lex law'
        : 'LegalViz.EU - Navigate to a supported EUR-Lex page to use this extension',
    });
  } catch (error) {
    console.error('Failed to update extension icon state:', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('LegalViz.EU extension installed');

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id != null) {
        updateIconState(tab.id);
      }
    });
  });
});

chrome.action.onClicked.addListener((tab) => {
  openInLegalViz(tab).catch((error) => {
    console.error('Failed to open LegalViz import:', error);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url || tab?.url) {
    updateIconState(tabId);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateIconState(tabId);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action !== 'openImportFromPage') {
    return false;
  }

  openInLegalViz({
    url: request.url || sender.tab?.url || '',
  })
    .then(() => sendResponse({ success: true }))
    .catch((error) => {
      console.error('Failed to auto-open LegalViz import:', error);
      sendResponse({ success: false, error: String(error?.message || error) });
    });

  return true;
});
