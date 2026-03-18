const FORMEX_DB_NAME = "formex-cache";
const MIGRATION_VERSION_KEY = "legalviz-migration-version";
const CURRENT_MIGRATION_VERSION = "2026-03-formex-only";
const APP_STORAGE_PREFIXES = ["legalviz-", "eurlex_", "nlp_v", "nlp_map_"];
const APP_STORAGE_KEYS = [
  "vite-ui-theme",
];

function removeAppStorageKeys() {
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;

      if (APP_STORAGE_KEYS.includes(key) || APP_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }

    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

function clearSessionStorage() {
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
}

function deleteIndexedDb(name) {
  return new Promise((resolve) => {
    try {
      if (!window.indexedDB) {
        resolve();
        return;
      }

      const request = window.indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearBrowserCaches() {
  try {
    if (!("caches" in window)) return;
    const cacheNames = await window.caches.keys();
    await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
  } catch {
    // ignore
  }
}

async function unregisterServiceWorkers() {
  try {
    if (!("serviceWorker" in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // ignore
  }
}

async function clearLocalBrowserData() {
  removeAppStorageKeys();
  clearSessionStorage();
  await deleteIndexedDb(FORMEX_DB_NAME);
  await clearBrowserCaches();
  await unregisterServiceWorkers();
}

export async function runOneTimeMigrationReset() {
  try {
    if (window.localStorage.getItem(MIGRATION_VERSION_KEY) === CURRENT_MIGRATION_VERSION) {
      return false;
    }
  } catch {
    // Keep going and attempt the reset.
  }

  await clearLocalBrowserData();

  try {
    window.localStorage.setItem("legalviz-formex-lang", "EN");
    window.localStorage.setItem(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION);
  } catch {
    // ignore
  }

  return true;
}

export async function resetWholeApp() {
  const confirmed = window.confirm(
    "This will remove local settings, imported laws, cached Formex data, and offline app caches stored by LegalViz in this browser. Continue?"
  );

  if (!confirmed) return false;

  await clearLocalBrowserData();

  window.location.href = window.location.origin + window.location.pathname;
  return true;
}
