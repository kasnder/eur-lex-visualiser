/* global chrome */

(function () {
  'use strict';

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

  function isAutoOpenPage(urlString) {
    if (!urlString) return false;

    try {
      const url = new URL(urlString);
      return url.hostname === 'eur-lex.europa.eu' &&
        url.pathname.includes('/legal-content/') &&
        url.pathname.includes('/TXT/HTML/') &&
        !!url.searchParams.get('uri');
    } catch {
      return false;
    }
  }

  function shouldAutoOpen(urlString) {
    return isAutoOpenPage(urlString);
  }

  function autoOpenIfNeeded() {
    const pageUrl = window.location.href;
    if (!shouldAutoOpen(pageUrl)) {
      return;
    }

    chrome.runtime.sendMessage({
      action: 'openImportFromPage',
      url: pageUrl,
    });
  }

  if (document.readyState === 'complete') {
    autoOpenIfNeeded();
  } else {
    window.addEventListener('load', autoOpenIfNeeded, { once: true });
  }
})();
