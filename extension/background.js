// Background service worker for the extension
// Handles storage retrieval for content scripts and opening tabs

// ============================================================================
// CONFIGURATION - AUTOMATIC DETECTION
// ============================================================================

const LOCALHOST_URL = 'http://localhost:5173';
const PRODUCTION_URL = 'https://legalviz.eu';

// Helper to check if localhost is reachable and is the correct app
async function checkLocalhost() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000); // 1s timeout to allow for body read
    
    const response = await fetch(LOCALHOST_URL, { method: 'GET', signal: controller.signal }).catch(() => null);
    clearTimeout(timeoutId);
    
    if (response && response.ok) {
      const text = await response.text();
      // Verify it's our app by checking the title
      return text.includes('<title>LegalViz.EU</title>');
    }
    return false;
  } catch (e) {
    return false;
  }
}

// Determine environment and initialize config
async function initializeConfig() {
  // Simply check if localhost is reachable
  const useLocalhost = await checkLocalhost();
  
  if (useLocalhost) {
    console.log('*** DEBUGGING MODE: Localhost detected, using development server ***');
  } else {
    console.log('Environment: Production (Localhost not reachable)');
  }

  const config = {
    useLocalhost: useLocalhost,
    baseUrl: useLocalhost ? LOCALHOST_URL : PRODUCTION_URL,
    localhostUrl: LOCALHOST_URL,
    productionUrl: PRODUCTION_URL,
    lastChecked: Date.now()
  };

  await chrome.storage.local.set({ eurlexConfig: config });
  return config;
}

// Default config for fallback
const defaultConfig = {
  useLocalhost: false,
  baseUrl: PRODUCTION_URL,
  localhostUrl: LOCALHOST_URL,
  productionUrl: PRODUCTION_URL
};

// Initialize on install or update
chrome.runtime.onInstalled.addListener(() => {
  console.log('LegalViz.EU extension installed/updated');
  initializeConfig();
  // Initialize icons for all open tabs
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id) {
        updateIconState(tab.id);
      }
    });
  });
});

// Re-check on browser startup
chrome.runtime.onStartup.addListener(() => {
  initializeConfig();
});

// Helper to get config from storage
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['eurlexConfig'], (result) => {
      resolve(result.eurlexConfig || defaultConfig);
    });
  });
}

async function getExtensionUrl(storageKey) {
  const config = await getConfig();
  return `${config.baseUrl}/extension?extension=true&key=${encodeURIComponent(storageKey)}`;
}

// Check if URL is a valid EUR-Lex page (legal-content or eli/reg)
function isValidPage(url) {
  if (!url) return false;
  const urlLower = url.toLowerCase();
  return urlLower.includes('eur-lex.europa.eu/legal-content/') || 
         urlLower.includes('eur-lex.europa.eu/eli/reg');
}

// Update icon state based on whether the page is valid
async function updateIconState(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isValidPage(tab.url)) {
      // Enable icon - use colored icons
      chrome.action.setIcon({
        tabId: tabId,
        path: {
          16: 'icon16.png',
          48: 'icon48.png',
          128: 'icon128.png'
        }
      });
      chrome.action.setBadgeText({ tabId: tabId, text: '' });
      chrome.action.setTitle({ 
        tabId: tabId, 
        title: 'LegalViz.EU - Click to capture and visualise this page' 
      });
    } else {
      // Disable icon - use greyscale icons (default)
      chrome.action.setIcon({
        tabId: tabId,
        path: {
          16: 'icon16-grey.png',
          48: 'icon48-grey.png',
          128: 'icon128-grey.png'
        }
      });
      chrome.action.setBadgeText({ tabId: tabId, text: '' });
      chrome.action.setTitle({ 
        tabId: tabId, 
        title: 'LegalViz.EU - Navigate to a EUR-Lex legal-content page to use this extension' 
      });
    }
  } catch (error) {
    console.error('Error updating icon state:', error);
  }
}




// Update icon when tab is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateIconState(tabId);
  }
});

// Update icon when tab is activated
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateIconState(activeInfo.tabId);
});

// Clean up old stored HTML to free up storage space
async function cleanupOldStorage() {
  try {
    const allItems = await new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        resolve(items || {});
      });
    });
    
    // Find all law storage keys
    const lawKeys = Object.keys(allItems).filter(key => 
      key.startsWith('eurlex_law_')
    );
    
    // Also clean up old legacy keys if any
    const legacyKeys = Object.keys(allItems).filter(key => 
      key.startsWith('eurlex_html_')
    );
    
    // If we have more than 100 stored pages, remove the oldest ones
    if (lawKeys.length > 100) {
      // Sort by timestamp if available, or just by key
      // We need to read the items to know timestamps, but we already have them in allItems
      const laws = lawKeys.map(key => ({
        key,
        timestamp: allItems[key]?.metadata?.timestamp || 0
      }));
      
      laws.sort((a, b) => b.timestamp - a.timestamp); // Newest first
      
      const keysToRemove = laws.slice(100).map(l => l.key);
      if (keysToRemove.length > 0) {
        await new Promise((resolve) => chrome.storage.local.remove(keysToRemove, resolve));
        console.log(`Cleaned up ${keysToRemove.length} old law entries`);
      }
    }
    
    // Remove legacy keys
    if (legacyKeys.length > 0) {
      await new Promise((resolve) => chrome.storage.local.remove(legacyKeys, resolve));
      console.log(`Cleaned up ${legacyKeys.length} legacy entries`);
    }

  } catch (error) {
    console.error('Error cleaning up storage:', error);
  }
}

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  // ... (Keep existing logic, but update storage call if needed. 
  // However, content.js handles the capture usually.
  // The icon click handler executes a script. I should update that script too.)
  console.log('Icon clicked, tab URL:', tab.url);
  
  // Check if it's a valid EUR-Lex page (legal-content or eli/reg)
  const urlLower = tab.url ? tab.url.toLowerCase() : '';
  const isLegalContent = urlLower.includes('eur-lex.europa.eu/legal-content/');
  const isEliReg = urlLower.includes('eur-lex.europa.eu/eli/reg');
  
  if (!tab.url || (!isLegalContent && !isEliReg)) {
    console.log('Not a valid EUR-Lex page, ignoring click. URL:', tab.url);
    return;
  }
  
  console.log('Extension icon clicked on EUR-Lex page:', tab.url, 'Type:', isLegalContent ? 'legal-content' : 'eli/reg');
  
  try {
    // Capture HTML and title from the current tab
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // We'll use a simplified version here as we can't easily inject the full smart parser
        // or we rely on the content script being present. 
        // Ideally we should message the content script to do the capture.
        
        // Let's try to find the title
        let title = 'Untitled Law';
        try {
           const titleEl = document.querySelector(".oj-doc-ti, .doc-ti, .title-doc-first");
           if (titleEl) {
             title = titleEl.textContent.replace(/\s+/g, " ").trim();
           } else {
             title = document.title;
           }
        } catch (e) {
          console.error('Error extracting title:', e);
        }
        
        return {
          html: document.documentElement.outerHTML,
          url: window.location.href,
          title: title
        };
      }
    });
    
    console.log('Script execution results:', results);
    
    if (results && results[0] && results[0].result) {
      const { html, url, title } = results[0].result;
      
      // Create storage key
      const sanitized = title.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storageKey = `eurlex_law_${sanitized}`;
      
      console.log('Extracted title:', title, 'Storage key:', storageKey);
      
      // Clean up old storage
      await cleanupOldStorage();
      
      // Store HTML and metadata
      const data = {
        html: html,
        metadata: {
          title: title,
          url: url,
          timestamp: Date.now()
        }
      };

      await chrome.storage.local.set({
        [storageKey]: data
      });
      
      console.log('Law stored with key:', storageKey);
      
      // Open visualiser
      const visualiserUrl = await getExtensionUrl(storageKey);
      console.log('Opening visualiser URL:', visualiserUrl);
      chrome.tabs.create({ url: visualiserUrl });
    } else {
      console.error('No results from script execution');
    }
  } catch (error) {
    console.error('Error capturing page on icon click:', error);
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getHtml' || request.action === 'getLaw') {
    const storageKey = request.storageKey;
    chrome.storage.local.get([storageKey], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        const item = result[storageKey];
        if (item && item.html) {
           // New format
           sendResponse({
             html: item.html,
             metadata: item.metadata
           });
        } else if (item && typeof item === 'string') {
           // Legacy format fallback (should be cleaned up but just in case)
           sendResponse({
             html: item,
             metadata: { title: 'Legacy Law', url: '' }
           });
        } else {
           sendResponse({ html: null });
        }
      }
    });
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'getLawList') {
    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      
      const laws = [];
      Object.keys(items).forEach(key => {
        if (key.startsWith('eurlex_law_')) {
          const item = items[key];
          if (item && item.metadata) {
            laws.push({
              key: key, // Use storage key as ID
              ...item.metadata
            });
          }
        }
      });
      
      // Sort by timestamp descending
      laws.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      sendResponse({ laws });
    });
    return true;
  }
  
  if (request.action === 'deleteLaw') {
    const key = request.storageKey;
    chrome.storage.local.remove(key, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }

  if (request.action === 'cleanupStorage') {
    cleanupOldStorage().then(() => sendResponse({ success: true }));
    return true;
  }
  
  if (request.action === 'openLocalhost') {
    // Open visualiser in new tab
    chrome.tabs.create({ url: request.url }, (tab) => {
      console.log('Opened visualiser in tab:', tab.id);
      sendResponse({ success: true });
    });
    return true;
  }
});
