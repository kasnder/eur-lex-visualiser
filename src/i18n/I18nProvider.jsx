import { createContext, useEffect, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import bg from "./locales/bg.json";
import cs from "./locales/cs.json";
import da from "./locales/da.json";
import de from "./locales/de.json";
import el from "./locales/el.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import et from "./locales/et.json";
import fi from "./locales/fi.json";
import fr from "./locales/fr.json";
import ga from "./locales/ga.json";
import hr from "./locales/hr.json";
import hu from "./locales/hu.json";
import it from "./locales/it.json";
import lt from "./locales/lt.json";
import lv from "./locales/lv.json";
import mt from "./locales/mt.json";
import nl from "./locales/nl.json";
import pl from "./locales/pl.json";
import pt from "./locales/pt.json";
import ro from "./locales/ro.json";
import sk from "./locales/sk.json";
import sl from "./locales/sl.json";
import sv from "./locales/sv.json";
import {
  UI_LOCALE_STORAGE_KEY,
  UI_LOCALES,
  SUPPORTED_UI_LOCALES,
  getRouteLocale,
  normalizeUiLocale,
  localizePath,
  isCompatibilityPath,
} from "./localeMeta.js";

const catalogs = { bg, cs, da, de, el, en, es, et, fi, fr, ga, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, sk, sl, sv };

const I18nContext = createContext(null);

function getMessage(catalog, key) {
  return String(key || "")
    .split(".")
    .reduce((value, part) => (value && typeof value === "object" ? value[part] : undefined), catalog);
}

function formatMessage(message, vars = {}) {
  if (typeof message !== "string") return "";
  return message.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

function detectStoredLocale() {
  try {
    return normalizeUiLocale(localStorage.getItem(UI_LOCALE_STORAGE_KEY) || "en");
  } catch {
    return "en";
  }
}

function detectBrowserLocale() {
  if (typeof navigator === "undefined") return "en";
  const candidates = [...(navigator.languages || []), navigator.language].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = normalizeUiLocale(String(candidate).split("-")[0]);
    if (SUPPORTED_UI_LOCALES.includes(normalized)) return normalized;
  }
  return "en";
}

export function I18nProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const routeLocale = getRouteLocale(location.pathname);

  const locale = useMemo(() => {
    if (routeLocale) return routeLocale;
    if (isCompatibilityPath(location.pathname)) {
      return detectStoredLocale() || detectBrowserLocale() || "en";
    }
    return "en";
  }, [location.pathname, routeLocale]);

  useEffect(() => {
    try {
      localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore persistence failures
    }
    document.documentElement.lang = UI_LOCALES[locale]?.bcp47 || "en-GB";
  }, [locale]);

  const t = useCallback((key, vars = {}) => {
    const catalog = catalogs[locale] || en;
    const value = getMessage(catalog, key) ?? getMessage(en, key) ?? key;
    return formatMessage(value, vars);
  }, [locale]);

  const setLocale = useCallback((nextLocale) => {
    const normalized = normalizeUiLocale(nextLocale);
    try {
      localStorage.setItem(UI_LOCALE_STORAGE_KEY, normalized);
    } catch {
      // ignore persistence failures
    }

    if (!isCompatibilityPath(location.pathname)) {
      const nextPath = localizePath(location.pathname, normalized);
      navigate(`${nextPath}${location.search}${location.hash}`, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  const value = useMemo(() => ({
    locale,
    localeMeta: UI_LOCALES[locale],
    locales: UI_LOCALES,
    t,
    setLocale,
    localizePath: (pathname, nextLocale = locale) => localizePath(pathname, nextLocale),
  }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export { I18nContext };
