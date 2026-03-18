import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Info, Loader2, Menu, RefreshCw } from "lucide-react";

import { LAWS } from "../constants/laws.js";
import { fetchText } from "../utils/fetch.js";
import { parseAnyToCombined } from "../utils/parsers.js";
import { buildEurlexCelexUrl, buildEurlexOjUrl, buildEurlexSearchUrl, getLawPathFromKey } from "../utils/url.js";
import { mapRecitalsToArticles, NLP_VERSION } from "../utils/nlp.js";
import { injectDefinitionTooltips } from "../utils/definitions.js";
import { fetchFormex, extractCelexFromUrl, FormexApiError, resolveEurlexUrl, resolveOfficialReference } from "../utils/formexApi.js";
import { parseOfficialReference } from "../utils/officialReferences.js";

import { Button } from "./Button.jsx";
import { Accordion } from "./Accordion.jsx";
import { TopBar } from "./TopBar.jsx";
import { NavigationControls } from "./NavigationControls.jsx";
import { PrintModal } from "./PrintModal.jsx";
import { PrintView } from "./PrintView.jsx";
import { SEO } from "./SEO.jsx";
import { NumberSelector } from "./NumberSelector.jsx";
import { RelatedRecitals } from "./RelatedRecitals.jsx";
import { CrossReferences } from "./CrossReferences.jsx";

const EMPTY_LAW_DATA = { title: "", articles: [], recitals: [], annexes: [], definitions: [] };

function getLoadErrorDetails(error) {
  if (error instanceof FormexApiError) {
    return {
      message: error.message || "The law could not be loaded from the Formex service.",
      fallbackUrl: error.fallback?.url || error.details?.fallback?.url || null,
      status: error.status || null,
    };
  }

  return {
    message: String(error?.message || error || "The law could not be loaded."),
    fallbackUrl: null,
    status: null,
  };
}

export function LawViewer() {
  const { key, kind, id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const importCelex = searchParams.get("celex");
  const sourceUrl = searchParams.get("sourceUrl");
  const isImportedMode = !!(importCelex || sourceUrl);
  const lawPath = getLawPathFromKey(key);
  const [data, setData] = useState(EMPTY_LAW_DATA);
  const [recitalMap, setRecitalMap] = useState(new Map());
  const [selected, setSelected] = useState({ kind: "article", id: null, html: "" });
  const [returnToArticle, setReturnToArticle] = useState(null); // { id: string, title: string } | null
  const [openChapter, setOpenChapter] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isExtensionMode, setIsExtensionMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printOptions, setPrintOptions] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // View Settings
  const [fontScale, setFontScale] = useState(() => {
    try {
      return parseInt(localStorage.getItem("legalviz-fontscale") || "2");
    } catch {
      return 2;
    }
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try {
      const stored = localStorage.getItem("legalviz-sidebar");
      return stored !== "false"; // Default to true if not set
    } catch {
      return true;
    }
  });

  // Formex API settings (default). Legacy XHTML parsing remains only as a
  // deprecated fallback for sources that do not have Formex available.
  const [useFormex, setUseFormex] = useState(() => {
    try {
      const stored = localStorage.getItem("legalviz-use-formex");
      return stored == null ? true : stored === "true";
    } catch {
      return true;
    }
  });
  const [formexLang, setFormexLang] = useState(() => {
    try {
      return localStorage.getItem("legalviz-formex-lang") || "EN";
    } catch {
      return "EN";
    }
  });

  useEffect(() => {
    localStorage.setItem("legalviz-fontscale", fontScale);
  }, [fontScale]);

  useEffect(() => {
    localStorage.setItem("legalviz-sidebar", isSidebarOpen);
  }, [isSidebarOpen]);

  useEffect(() => {
    localStorage.setItem("legalviz-use-formex", useFormex);
  }, [useFormex]);

  useEffect(() => {
    localStorage.setItem("legalviz-formex-lang", formexLang);
  }, [formexLang]);

  const onIncreaseFont = () => setFontScale(s => Math.min(s + 1, 5));
  const onDecreaseFont = () => setFontScale(s => Math.max(s - 1, 1));
  const onToggleSidebar = () => setIsSidebarOpen(s => !s);
  const currentContentLang = useMemo(() => (useFormex ? formexLang : data.langCode || "EN"), [useFormex, formexLang, data.langCode]);

  const getImportParams = useCallback((overrides = {}) => {
    const nextCelex = overrides.celex || importCelex;
    if (!nextCelex) return "";
    const params = new URLSearchParams();
    params.set("celex", nextCelex);

    const raw = overrides.raw || searchParams.get("raw");
    if (raw) params.set("raw", raw);

    return `?${params.toString()}`;
  }, [isImportedMode, importCelex, searchParams]);

  // Map scale to prose class and percentage for display
  const getProseClass = (s) => {
    switch (s) {
      case 1: return "prose-sm";
      case 2: return "prose-base";
      case 3: return "prose-lg";
      case 4: return "prose-xl";
      case 5: return "prose-2xl";
      default: return "prose-lg";
    }
  };

  const getTextClass = (s) => {
    switch (s) {
      case 1: return "text-sm";
      case 2: return "text-base";
      case 3: return "text-lg";
      case 4: return "text-xl";
      case 5: return "text-2xl";
      default: return "text-lg";
    }
  };

  const getFontPercent = (s) => {
    switch (s) {
      case 1: return 75;
      case 2: return 100;
      case 3: return 125;
      case 4: return 150;
      case 5: return 200;
      default: return 125;
    }
  };

  const loadLaw = React.useCallback(async (path, celex, lang) => {
    if (!path && !celex) return;
    setLoading(true);
    setLoadError(null);
    setData(EMPTY_LAW_DATA);
    setSelected({ kind: "article", id: null, html: "" });
    setReturnToArticle(null);
    try {
      let text;
      if (celex && lang) {
        // Load from Formex API
        text = await fetchFormex(celex, lang);
      } else {
        // Load from local file
        text = await fetchText(path);
      }
      const combined = parseAnyToCombined(text);
      setData(combined);
    } catch (e) {
      setLoadError(getLoadErrorDetails(e));
      setData(EMPTY_LAW_DATA);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFromExtension = React.useCallback(async (htmlString, metadata) => {
    if (!htmlString) {
      console.error('loadFromExtension called with empty htmlString');
      return;
    }
    setLoading(true);
    setLoadError(null);
    setData(EMPTY_LAW_DATA);
    setSelected({ kind: "article", id: null, html: "" });
    setReturnToArticle(null);
    setIsExtensionMode(true);
    try {
      console.log('Parsing HTML from extension, length:', htmlString.length);
      const combined = parseAnyToCombined(htmlString);

      // Use metadata title if available and parsed title is empty or generic
      if (metadata?.title && (!combined.title || combined.title === 'Untitled Law')) {
        combined.title = metadata.title;
      }

      // Use metadata url if available
      if (metadata?.url) {
        // Ensure we link to the main text view, not the HTML-specific view
        combined.eurlex = metadata.url.replace(/\/TXT\/HTML\//, '/TXT/');
      }

      console.log('Parsed result:', {
        articles: combined.articles?.length || 0,
        recitals: combined.recitals?.length || 0,
        annexes: combined.annexes?.length || 0
      });
      setData(combined);
    } catch (e) {
      console.error('Error parsing HTML from extension:', e);
      setLoadError(getLoadErrorDetails(e));
      setData(EMPTY_LAW_DATA);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (data.articles?.length > 0 && data.recitals?.length > 0) {

      // Clean up old NLP cache entries (old versions and legacy keys)
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('nlp_map_') || k.startsWith('nlp_v'))) {
            // Remove legacy nlp_map_ keys and old versioned keys
            if (k.startsWith('nlp_map_') || !k.startsWith(`nlp_v${NLP_VERSION}_`)) {
              keysToRemove.push(k);
            }
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      } catch (e) {
        console.warn('Error cleaning up old NLP cache', e);
      }

      // Generate a cache key for NLP results
      let cacheKey = null;
      const formexSuffix = useFormex ? `_fmx_${formexLang}` : '';
      if (key && !isExtensionMode) {
        cacheKey = `nlp_v${NLP_VERSION}_${key}${formexSuffix}`;
      } else if (isExtensionMode && data.title) {
        // Fallback for extension mode if title exists
        // Simple hash of title + lengths to identify specific content
        const safeTitle = data.title.replace(/\s+/g, '_').substring(0, 50);
        cacheKey = `nlp_v${NLP_VERSION}_ext_${safeTitle}_${data.articles.length}_${data.recitals.length}`;
      }

      // 1. Try to load from cache
      if (cacheKey) {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            // console.log("Loaded NLP mapping from cache:", cacheKey);
            const entries = JSON.parse(cached);
            setRecitalMap(new Map(entries));
            return;
          }
        } catch (e) {
          console.warn('Error reading NLP cache', e);
        }
      }

      // 2. If not cached, compute in background (setTimeout)
      const timer = setTimeout(() => {
        // console.time("NLP Calculation");
        const map = mapRecitalsToArticles(data.recitals, data.articles);
        // console.timeEnd("NLP Calculation");
        setRecitalMap(map);

        // 3. Save to cache
        if (cacheKey) {
          try {
            // Map entries -> Array of [key, value] for JSON
            localStorage.setItem(cacheKey, JSON.stringify(Array.from(map.entries())));
          } catch (e) {
            console.warn('Error writing NLP cache', e);
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setRecitalMap(new Map());
    }
  }, [data.articles, data.recitals, key, isExtensionMode, data.title, useFormex, formexLang]);

  // Ref to track the currently loaded law key to prevent re-loading on navigation
  const loadedKeyRef = React.useRef(null);

  // Request law content via postMessage when in extension mode
  useEffect(() => {
    const isExtension = searchParams.get('extension') === 'true';
    const storageKey = searchParams.get('key');

    if (isExtension && storageKey) {
      // If we already loaded this key and have data, don't reload.
      // This prevents reloading when navigating between articles of the same law.
      const formexSuffix = useFormex ? `_formex_${formexLang}` : '';
      if (loadedKeyRef.current === storageKey + formexSuffix && data.title) {
        return;
      }

      console.log('Extension mode detected, loading storage key:', storageKey);
      loadedKeyRef.current = storageKey + formexSuffix;
      setIsExtensionMode(true);
      setLoading(true);

      let isResponseReceived = false;

      const handleMessage = (event) => {
        if (event.source !== window) return;

        if (event.data.type === 'EURLEX_LAW_DATA') {
          const payload = event.data.payload;
          if (payload.error) {
            console.error('Extension error:', payload.error);
            setLoadError({
              message: `Error loading law: ${payload.error}`,
              fallbackUrl: null,
              status: null,
            });
            setData(EMPTY_LAW_DATA);
            setLoading(false);
            isResponseReceived = true;
          } else if (payload.html) {
            console.log('Received law data from extension');
            isResponseReceived = true;

            // If Formex is enabled, try to extract CELEX from the metadata URL
            // and load via API instead of parsing the extension HTML
            if (useFormex && payload.metadata?.url) {
              const celex = extractCelexFromUrl(payload.metadata.url);
              if (celex) {
                console.log(`Extension: using Formex API for CELEX ${celex} (${formexLang})`);
                loadLaw(null, celex, formexLang).then(() => {
                  setIsExtensionMode(true); // re-set since loadLaw doesn't set it
                });
                return;
              }
            }

            loadFromExtension(payload.html, payload.metadata);
          } else {
            // Empty response, wait for retry
          }
        }
      };

      window.addEventListener('message', handleMessage);

      // Request data immediately
      window.postMessage({ type: 'EURLEX_GET_LAW', key: storageKey }, '*');

      // Poll in case the extension bridge script hasn't loaded yet
      const pollInterval = setInterval(() => {
        if (isResponseReceived) {
          clearInterval(pollInterval);
          return;
        }
        console.log('Polling for law data...');
        window.postMessage({ type: 'EURLEX_GET_LAW', key: storageKey }, '*');
      }, 500);

      // Stop polling after 5 seconds to avoid infinite loops if something is wrong
      const timeout = setTimeout(() => {
        clearInterval(pollInterval);
        if (!isResponseReceived && !data.title) {
          setLoadError({
            message: "Timed out waiting for extension data. Please ensure the extension is installed and active.",
            fallbackUrl: null,
            status: null,
          });
          setData(EMPTY_LAW_DATA);
          setLoading(false);
        }
      }, 5000);

      return () => {
        window.removeEventListener('message', handleMessage);
        clearInterval(pollInterval);
        clearTimeout(timeout);
      };
    }
  }, [searchParams, loadFromExtension, loadLaw, data.title, useFormex, formexLang, loadAttempt]);

  // Resolve CELEX for the current law key
  const currentLaw = LAWS.find(l => l.key === key);
  const currentCelex = importCelex || currentLaw?.celex || null;

  useEffect(() => {
    if (!sourceUrl || importCelex) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    resolveEurlexUrl(sourceUrl, formexLang)
      .then((result) => {
        if (cancelled) return;

        const resolvedCelex = result?.resolved?.celex;
        if (!resolvedCelex) {
          setLoadError({
            message: "This EUR-Lex page could not be resolved to an importable CELEX document.",
            fallbackUrl: sourceUrl,
            status: result?.status || null,
          });
          setLoading(false);
          return;
        }

        const params = new URLSearchParams();
        params.set("celex", resolvedCelex);
        navigate(`/import?${params.toString()}`, { replace: true });
      })
      .catch((error) => {
        if (cancelled) return;
        const details = getLoadErrorDetails(error);
        setLoadError({
          ...details,
          fallbackUrl: details.fallbackUrl || sourceUrl,
        });
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sourceUrl, importCelex, formexLang, navigate, loadAttempt]);

  // Load law when path/formex settings change
  useEffect(() => {
    if (isExtensionMode) return; // Don't load from file if we're in extension mode
    if (sourceUrl && !currentCelex) return;

    if (useFormex && currentCelex) {
      loadLaw(lawPath, currentCelex, formexLang);
    } else if (isImportedMode && currentCelex) {
      loadLaw(null, currentCelex, formexLang);
    } else if (lawPath) {
      loadLaw(lawPath);
    } else if (key) {
      // Only redirect if we have a key but no matching law path
      navigate("/", { replace: true });
    }
  }, [lawPath, key, loadLaw, navigate, isExtensionMode, useFormex, currentCelex, formexLang, isImportedMode, loadAttempt, sourceUrl]);

  // Update selection from URL params when data is loaded or URL params change
  useEffect(() => {
    if (!data.articles?.length && !data.recitals?.length && !data.annexes?.length) {
      // Data not loaded yet, wait for it
      return;
    }

    // Try to select from URL params
    if (kind && id) {
      let found = false;
      if (kind === "article") {
        const article = data.articles?.find(a => a.article_number === id);
        if (article) {
          setSelected({ kind: "article", id: article.article_number, html: article.article_html });
          found = true;
        }
      } else if (kind === "recital") {
        const recital = data.recitals?.find(r => r.recital_number === id);
        if (recital) {
          setSelected({ kind: "recital", id: recital.recital_number, html: recital.recital_html });
          found = true;
        }
      } else if (kind === "annex") {
        const annex = data.annexes?.find(a => a.annex_id === id);
        if (annex) {
          setSelected({ kind: "annex", id: annex.annex_id, html: annex.annex_html });
          found = true;
        }
      }

      if (found) {
        return;
      }
    }

    // If no URL params or they didn't match, select default and update URL
    if (!kind || !id) {
      const extensionKey = isExtensionMode ? searchParams.get('key') : null;
      const extensionParams = extensionKey ? `?extension=true&key=${extensionKey}` : '';
      const importParams = getImportParams();

      if (data.articles?.[0]) {
        const a0 = data.articles[0];
        setSelected({ kind: "article", id: a0.article_number, html: a0.article_html });
        if (isExtensionMode) {
          // In extension mode, update URL without key
          navigate(`/extension/article/${a0.article_number}${extensionParams}`, { replace: true });
        } else if (isImportedMode) {
          navigate(`/import/article/${a0.article_number}${importParams}`, { replace: true });
        } else {
          navigate(`/law/${key}/article/${a0.article_number}`, { replace: true });
        }
      } else if (data.recitals?.[0]) {
        const r0 = data.recitals[0];
        setSelected({ kind: "recital", id: r0.recital_number, html: r0.recital_html });
        if (isExtensionMode) {
          navigate(`/extension/recital/${r0.recital_number}${extensionParams}`, { replace: true });
        } else if (isImportedMode) {
          navigate(`/import/recital/${r0.recital_number}${importParams}`, { replace: true });
        } else {
          navigate(`/law/${key}/recital/${r0.recital_number}`, { replace: true });
        }
      } else if (data.annexes?.[0]) {
        const x0 = data.annexes[0];
        setSelected({ kind: "annex", id: x0.annex_id, html: x0.annex_html });
        if (isExtensionMode) {
          navigate(`/extension/annex/${x0.annex_id}${extensionParams}`, { replace: true });
        } else if (isImportedMode) {
          navigate(`/import/annex/${x0.annex_id}${importParams}`, { replace: true });
        } else {
          navigate(`/law/${key}/annex/${x0.annex_id}`, { replace: true });
        }
      }
    }
  }, [data, kind, id, key, navigate, isExtensionMode, searchParams, isImportedMode, getImportParams]);

  // Group articles by chapter for TOC
  const toc = useMemo(() => {
    const chapters = [];
    const chMap = new Map(); // chapterLabel -> chapterObj

    const label = (d) => (d ? [d.number, d.title].filter(Boolean).join(" — ").trim() : "");

    for (const a of data.articles) {
      const chLabel = label(a?.division?.chapter) || "(Untitled Chapter)";
      const scLabel = label(a?.division?.section) || null;

      let ch = chMap.get(chLabel);
      if (!ch) {
        ch = { label: chLabel, items: [], sections: [], secMap: new Map() };
        chMap.set(chLabel, ch);
        chapters.push(ch);
      }

      if (scLabel) {
        let sec = ch.secMap.get(scLabel);
        if (!sec) {
          sec = { label: scLabel, items: [] };
          ch.secMap.set(scLabel, sec);
          ch.sections.push(sec);
        }
        sec.items.push(a);
      } else {
        ch.items.push(a);
      }
    }

    // drop helper maps before rendering
    chapters.forEach((c) => delete c.secMap);
    return chapters;
  }, [data.articles]);

  // Auto-expand TOC chapter when selection changes
  useEffect(() => {
    if (selected.kind === "article" && selected.id && toc.length > 0) {
      const foundCh = toc.find(
        (ch) =>
          ch.items.some((a) => a.article_number === selected.id) ||
          ch.sections.some((s) => s.items.some((a) => a.article_number === selected.id))
      );
      if (foundCh) {
        setOpenChapter(foundCh.label);
      }
    }
  }, [selected.kind, selected.id, toc]);

  // --- Selection helpers ---

  const getExtensionParams = useMemo(() => {
    if (!isExtensionMode) return '';
    const extensionKey = searchParams.get('key');
    return extensionKey ? `?extension=true&key=${extensionKey}` : '?extension=true';
  }, [isExtensionMode, searchParams]);

  const selectArticleIdx = (idx) => {
    const a = data.articles[idx];
    if (!a) return;
    setSelected({ kind: "article", id: a.article_number, html: a.article_html });
    if (isExtensionMode) {
      navigate(`/extension/article/${a.article_number}${getExtensionParams}`);
    } else if (isImportedMode) {
      navigate(`/import/article/${a.article_number}${getImportParams()}`);
    } else {
      navigate(`/law/${key}/article/${a.article_number}`);
    }
  };
  const selectRecitalIdx = (idx) => {
    const r = data.recitals[idx];
    if (!r) return;
    setSelected({ kind: "recital", id: r.recital_number, html: r.recital_html });
    if (isExtensionMode) {
      navigate(`/extension/recital/${r.recital_number}${getExtensionParams}`);
    } else if (isImportedMode) {
      navigate(`/import/recital/${r.recital_number}${getImportParams()}`);
    } else {
      navigate(`/law/${key}/recital/${r.recital_number}`);
    }
  };
  const selectAnnexIdx = (idx) => {
    const x = data.annexes[idx];
    if (!x) return;
    setSelected({ kind: "annex", id: x.annex_id, html: x.annex_html });
    if (isExtensionMode) {
      navigate(`/extension/annex/${x.annex_id}${getExtensionParams}`);
    } else if (isImportedMode) {
      navigate(`/import/annex/${x.annex_id}${getImportParams()}`);
    } else {
      navigate(`/law/${key}/annex/${x.annex_id}`);
    }
  };

  const onPrevNext = React.useCallback((kind, nextIndex) => {
    if (kind === "article") return selectArticleIdx(nextIndex);
    if (kind === "recital") return selectRecitalIdx(nextIndex);
    if (kind === "annex") return selectAnnexIdx(nextIndex);
  }, [selectArticleIdx, selectRecitalIdx, selectAnnexIdx]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing in an input or textarea
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      if (e.key === "ArrowLeft") {
        const { articles, recitals, annexes } = data;
        let currentList = [];
        let currentId = selected.id;

        if (selected.kind === "article") currentList = articles;
        else if (selected.kind === "recital") currentList = recitals;
        else if (selected.kind === "annex") currentList = annexes;

        if (currentList && currentList.length > 0) {
          const idx = currentList.findIndex(item =>
            (item.article_number === currentId) ||
            (item.recital_number === currentId) ||
            (item.annex_id === currentId)
          );
          if (idx > 0) onPrevNext(selected.kind, idx - 1);
        }
      } else if (e.key === "ArrowRight") {
        const { articles, recitals, annexes } = data;
        let currentList = [];
        let currentId = selected.id;

        if (selected.kind === "article") currentList = articles;
        else if (selected.kind === "recital") currentList = recitals;
        else if (selected.kind === "annex") currentList = annexes;

        if (currentList && currentList.length > 0) {
          const idx = currentList.findIndex(item =>
            (item.article_number === currentId) ||
            (item.recital_number === currentId) ||
            (item.annex_id === currentId)
          );
          if (idx >= 0 && idx < currentList.length - 1) onPrevNext(selected.kind, idx + 1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected, data, onPrevNext]);

  // Touch swipe navigation
  const touchStartRef = React.useRef(null);
  const touchEndRef = React.useRef(null);
  const minSwipeDistance = 50;

  const onTouchStart = (e) => {
    touchEndRef.current = null;
    touchStartRef.current = e.targetTouches[0].clientX;
  };

  const onTouchMove = (e) => {
    touchEndRef.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = () => {
    if (!touchStartRef.current || !touchEndRef.current) return;
    const distance = touchStartRef.current - touchEndRef.current;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    const { articles, recitals, annexes } = data;
    let currentList = [];
    let currentId = selected.id;

    if (selected.kind === "article") currentList = articles;
    else if (selected.kind === "recital") currentList = recitals;
    else if (selected.kind === "annex") currentList = annexes;

    if (currentList && currentList.length > 0) {
      const idx = currentList.findIndex(item =>
        (item.article_number === currentId) ||
        (item.recital_number === currentId) ||
        (item.annex_id === currentId)
      );

      if (isLeftSwipe) {
        // Swipe Left -> Next Article
        if (idx >= 0 && idx < currentList.length - 1) onPrevNext(selected.kind, idx + 1);
      }
      if (isRightSwipe) {
        // Swipe Right -> Prev Article
        if (idx > 0) onPrevNext(selected.kind, idx - 1);
      }
    }
  };


  const onClickArticle = (a) => {
    setReturnToArticle(null); // Clear return path when explicitly selecting an article
    selectArticleIdx(data.articles.findIndex((x) => x.article_number === a.article_number));
  };
  const onClickRecital = (r, fromArticleId = null) => {
    // If we're coming from an article, save that state so we can go back
    if (fromArticleId) {
      setReturnToArticle({ id: fromArticleId });
    } else if (selected.kind !== "recital") {
      // If we navigate away to something else (article/annex), clear the return path
      setReturnToArticle(null);
    }

    selectRecitalIdx(data.recitals.findIndex((x) => x.recital_number === r.recital_number));
  };
  const onClickAnnex = (ax) => {
    setReturnToArticle(null);
    selectAnnexIdx(data.annexes.findIndex((x) => x.annex_id === ax.annex_id));
  };

  // Navigate to article by number (for cross-reference clicks)
  const onCrossRefArticle = useCallback((articleNumber) => {
    const idx = data.articles.findIndex(a => a.article_number === articleNumber);
    if (idx !== -1) selectArticleIdx(idx);
  }, [data.articles, selectArticleIdx]);

  // Determine SEO metadata
  const seoData = useMemo(() => {
    // Determine the base name of the law:
    let lawName = data.title;
    if (!lawName) {
      if (isExtensionMode) {
        lawName = "Custom Law";
      } else if (key) {
        const law = LAWS.find((l) => l.key === key);
        lawName = law ? law.label : key;
      } else {
        lawName = "LegalViz.EU";
      }
    }

    let title = lawName;
    let description = "Interactive visualisation of EU laws. Navigate articles, recitals, and annexes with ease.";

    if (selected.id) {
      const kindLabel =
        selected.kind === "article"
          ? "Article"
          : selected.kind === "recital"
            ? "Recital"
            : "Annex";
      title = `${kindLabel} ${selected.id} - ${lawName}`;
      description = `Read ${kindLabel} ${selected.id} of ${lawName} on LegalViz.EU.`;

      // Try to add a bit of content preview to description if available
      // Note: HTML might need stripping, but keeping it simple for now
    }

    return { title, description };
  }, [key, selected.kind, selected.id, isExtensionMode, data.title]);

  const eurlexUrl = useMemo(() => {
    if (isExtensionMode) return data.eurlex || null;
    if (sourceUrl) return sourceUrl;
    if (isImportedMode && currentCelex) return buildEurlexCelexUrl(currentCelex, formexLang);
    const law = LAWS.find(l => l.key === key);
    return law ? law.eurlex : null;
  }, [key, isExtensionMode, isImportedMode, data.eurlex, currentCelex, formexLang, sourceUrl]);

  const hasLoadedContent = data.articles.length > 0 || data.recitals.length > 0 || data.annexes.length > 0;
  const currentLawLabel = useMemo(() => {
    if (data.title) return data.title;
    if (searchParams.get("raw")) return searchParams.get("raw");
    if (currentLaw?.label) return currentLaw.label;
    if (currentCelex) return `CELEX ${currentCelex}`;
    if (isExtensionMode) return "Imported law";
    return "";
  }, [data.title, searchParams, currentLaw, currentCelex, isExtensionMode]);

  const retryLoad = useCallback(() => {
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  const loadingMessage = useMemo(() => {
    if (isExtensionMode) {
      return useFormex && currentCelex
        ? `Loading ${currentLawLabel || "law"} from Formex...`
        : "Loading law from the browser extension...";
    }

    if (isImportedMode) {
      return `Loading ${currentLawLabel || "law"}...`;
    }

    return `Loading ${currentLawLabel || "law"}...`;
  }, [isExtensionMode, useFormex, currentCelex, currentLawLabel, isImportedMode]);

  const externalLawOverview = useMemo(() => {
    if (!data.crossReferences) return [];

    const items = new Map();
    const currentLang = currentContentLang;

    const buildExternalHref = (ref) => {
      if (ref.type === "oj_ref" && ref.ojColl && ref.ojNo && ref.ojYear) {
        return buildEurlexOjUrl({
          ojColl: ref.ojColl,
          ojYear: ref.ojYear,
          ojNo: ref.ojNo,
          langCode: currentLang,
        });
      }

      const label = ref.raw || ref.target;
      if (!label) return null;

      return buildEurlexSearchUrl(label, currentLang);
    };

    for (const refs of Object.values(data.crossReferences)) {
      for (const ref of refs || []) {
        if (ref.type !== "external" && ref.type !== "oj_ref") continue;

        const label = ref.raw || ref.target;
        if (!label) continue;

        const key = ref.type === "oj_ref"
          ? `oj:${ref.ojColl || ""}:${ref.ojYear || ""}:${ref.ojNo || ""}`
          : `external:${ref.target || label}`;

        const existing = items.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          items.set(key, {
            key,
            label,
            href: buildExternalHref(ref),
            count: 1,
            ref,
          });
        }
      }
    }

    return Array.from(items.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });
  }, [data.crossReferences, currentContentLang]);

  // Whether this law can be loaded via the Formex API
  const hasCelex = useMemo(() => {
    if (currentCelex) return true;
    // In extension mode, try to extract from the eurlex URL
    if (isExtensionMode && data.eurlex) {
      return !!extractCelexFromUrl(data.eurlex);
    }
    return false;
  }, [currentCelex, isExtensionMode, data.eurlex]);

  const openFallbackReference = useCallback((fallbackUrl) => {
    if (fallbackUrl) {
      window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    }
  }, []);

  const resolveReferenceInput = useCallback((refLike) => {
    if (!refLike) return null;

    const raw = refLike.raw || refLike.label || refLike.target || null;
    const parsed = parseOfficialReference(raw || "");

    return {
      raw,
      actType: refLike.actType || parsed?.actType || null,
      year: refLike.year || parsed?.year || null,
      number: refLike.number || parsed?.number || null,
      suffix: refLike.suffix || parsed?.suffix || null,
      ojColl: refLike.ojColl || null,
      ojNo: refLike.ojNo || null,
      ojYear: refLike.ojYear || null,
    };
  }, []);

  const handleOpenExternalLaw = useCallback(async (refLike) => {
    const reference = resolveReferenceInput(refLike);
    const fallbackUrl = refLike?.type === "oj_ref"
      ? buildEurlexOjUrl({
        ojColl: refLike.ojColl,
        ojYear: refLike.ojYear,
        ojNo: refLike.ojNo,
        langCode: currentContentLang,
      })
      : buildEurlexSearchUrl(refLike?.raw || refLike?.label || refLike?.target || "", currentContentLang);

    if (!reference?.actType || !reference?.year || !reference?.number) {
      openFallbackReference(fallbackUrl);
      return;
    }

    try {
      const result = await resolveOfficialReference(reference, currentContentLang);
      if (result?.resolved?.celex) {
        navigate(`/import${getImportParams({
          celex: result.resolved.celex,
          raw: reference.raw,
        })}`);
        return;
      }
      openFallbackReference(result?.fallback?.url || fallbackUrl);
    } catch (err) {
      if (err instanceof FormexApiError) {
        openFallbackReference(err.fallback?.url || err.details?.fallback?.url || fallbackUrl);
        return;
      }
      openFallbackReference(fallbackUrl);
    }
  }, [resolveReferenceInput, currentContentLang, openFallbackReference, navigate, getImportParams]);

  // Process HTML to inject definition tooltips
  const processedHtml = useMemo(() => {
    if (!selected.html) return "";
    // Skip injection for the definitions article itself
    const defArticle = selected.kind === "article" &&
      data.articles.find(a => a.article_number === selected.id);
    const skipDefinitions = defArticle?.article_title &&
      /definitions?|definicj/i.test(defArticle.article_title);
    return injectDefinitionTooltips(selected.html, data.definitions, {
      skipDefinitionsArticle: skipDefinitions,
      langCode: data.langCode
    });
  }, [selected.html, selected.kind, selected.id, data.definitions, data.articles, data.langCode]);

  // Handle printing
  useEffect(() => {
    if (printOptions) {
      const handlePrint = async () => {
        // Create new window
        const printWindow = window.open("", "_blank");
        if (!printWindow) {
          alert("Please allow popups to print");
          setPrintOptions(null);
          return;
        }

        // Copy styles
        const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'));
        styles.forEach(style => {
          printWindow.document.head.appendChild(style.cloneNode(true));
        });

        // Add extra print-specific styles to force visibility and background
        const extraStyle = printWindow.document.createElement("style");
        extraStyle.textContent = `
          body { background: white !important; margin: 0; }
          .print-container { display: block !important; }
        `;
        printWindow.document.head.appendChild(extraStyle);

        // Render PrintView into the new window
        const container = printWindow.document.createElement("div");
        container.className = "print-container";
        printWindow.document.body.appendChild(container);

        const root = createRoot(container);

        // Wrap in a promise to wait for render? 
        // React 18 createRoot is async-ish but text rendering is usually fast.
        // We'll use a small timeout to ensure styles are applied.
        root.render(<PrintView data={data} options={printOptions} />);

        // Wait for styles and content
        setTimeout(() => {
          printWindow.print();
          // Optional: printWindow.close(); // Don't auto-close so user can preview or PDF
          setPrintOptions(null);
        }, 500);
      };

      handlePrint();
    }
  }, [printOptions, data]);

  // --------- Main visualiser UI ----------
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white print:bg-white dark:from-gray-950 dark:to-gray-900 transition-colors duration-500">
      <SEO
        title={seoData.title}
        description={seoData.description}
        type="article"
      />
      <div className="print:hidden">
        <TopBar
          lawKey={isExtensionMode ? "extension" : isImportedMode ? "import" : key}
          title={currentLawLabel}
          lists={{ articles: data.articles, recitals: data.recitals, annexes: data.annexes }}
          isExtensionMode={isExtensionMode}
          isImportedMode={isImportedMode}
          eurlexUrl={eurlexUrl}
          onPrint={() => setPrintModalOpen(true)}
          onToggleSidebar={onToggleSidebar}
          isSidebarOpen={isSidebarOpen}
          onIncreaseFont={onIncreaseFont}
          onDecreaseFont={onDecreaseFont}
          fontSize={getFontPercent(fontScale)}
          formexLang={formexLang}
          onFormexLangChange={setFormexLang}
          useFormex={useFormex}
          onToggleFormex={setUseFormex}
          hasCelex={hasCelex}
        />

        <main className={`mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4 md:flex-row md:px-6 md:py-6 md:gap-6 justify-center`}>
          {/* Main Content Area (Left/Center) */}
          <div className={`min-w-0 w-full max-w-4xl order-2 md:order-1 transition-all duration-300`}>
            <section
              className="rounded-2xl border border-gray-200 bg-white p-6 md:p-12 shadow-sm min-h-[50vh] dark:bg-gray-900 dark:border-gray-800"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              {loading ? (
                <div className="flex min-h-[30vh] flex-col items-center justify-center text-center">
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                    <Loader2 size={28} className="animate-spin" />
                  </div>
                  <h2 className="text-2xl font-bold font-serif text-gray-900 tracking-tight dark:text-gray-100">
                    Loading law
                  </h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-gray-600 dark:text-gray-400">
                    {loadingMessage}
                  </p>
                  <div className="mt-8 w-full max-w-2xl space-y-3">
                    <div className="h-4 w-2/5 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
                    <div className="h-4 w-full animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
                    <div className="h-4 w-11/12 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
                    <div className="h-4 w-4/5 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
                  </div>
                </div>
              ) : loadError && !hasLoadedContent ? (
                <div className="flex min-h-[30vh] flex-col items-center justify-center text-center">
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8 dark:border-red-900 dark:bg-red-950/30">
                    <h2 className="text-2xl font-bold font-serif text-red-900 dark:text-red-200">
                      Law could not be loaded
                    </h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-red-700 dark:text-red-300">
                      {loadError.message}
                    </p>
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                      <Button type="button" onClick={retryLoad}>
                        <RefreshCw size={16} />
                        Retry
                      </Button>
                      {eurlexUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => window.open(loadError.fallbackUrl || eurlexUrl, "_blank", "noopener,noreferrer")}
                        >
                          Open on EUR-Lex
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4 gap-4">
                    <h2 className="text-2xl font-bold font-serif text-gray-900 tracking-tight truncate min-w-0 dark:text-gray-100">
                      {selected.kind === "article" && `Article ${selected.id || ""}`}
                      {selected.kind === "recital" && `Recital ${selected.id || ""}`}
                      {selected.kind === "annex" && `Annex ${selected.id || ""}`}
                      {!selected.id && "No selection"}
                    </h2>
                  </div>

                  <article
                    className={`prose prose-slate mx-auto ${getProseClass(fontScale)} ${getTextClass(fontScale)} mt-4 transition-all duration-200`}
                    dangerouslySetInnerHTML={{
                      __html:
                        processedHtml ||
                        "<div class='text-center text-gray-400 py-10'>Select an article, recital, or annex from the menu to begin reading.</div>",
                    }}
                    onClick={(e) => {
                      // Handle clicks on inline cross-reference links
                      const link = e.target.closest("a.cross-ref");
                      if (link) {
                        e.preventDefault();
                        const artNum = link.getAttribute("data-ref-article");
                        if (artNum) onCrossRefArticle(artNum);
                        return;
                      }

                      const externalLink = e.target.closest("a.external-ref");
                      if (externalLink) {
                        e.preventDefault();
                        handleOpenExternalLaw({
                          raw: externalLink.getAttribute("data-ref-raw") || externalLink.textContent,
                          actType: externalLink.getAttribute("data-ref-act-type") || null,
                          year: externalLink.getAttribute("data-ref-year") || null,
                          number: externalLink.getAttribute("data-ref-number") || null,
                          suffix: externalLink.getAttribute("data-ref-suffix") || null,
                        });
                      }
                    }}
                  />
                </>
              )}
            </section>

            {selected.kind === "article" && (
              <>
                <CrossReferences
                  articleNumber={selected.id}
                  crossReferences={data.crossReferences}
                  articles={data.articles}
                  onSelectArticle={onCrossRefArticle}
                  currentLang={useFormex ? formexLang : data.langCode}
                  onOpenExternalReference={handleOpenExternalLaw}
                />
                <RelatedRecitals
                  recitals={recitalMap.get(selected.id) || []}
                  allRecitals={data.recitals}
                  onSelectRecital={(r) => onClickRecital(r, selected.id)}
                />
              </>
            )}

            {loadError && hasLoadedContent && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{loadError.message}</span>
                  <Button type="button" variant="outline" size="sm" onClick={retryLoad}>
                    <RefreshCw size={14} />
                    Retry
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar (Right) */}
          <aside className={`w-full md:w-80 md:shrink-0 order-1 md:order-2 md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto transition-all duration-300 ${!isSidebarOpen ? 'md:hidden' : ''}`}>
            {/* Mobile Navigation & Toggle */}
            <div className="flex gap-2 mb-4 md:hidden">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="flex items-center justify-center p-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                title="Toggle Contents"
              >
                <Menu size={20} />
              </button>

              <div className="flex-1 min-w-0">
                <NavigationControls
                  selected={selected}
                  lists={{ articles: data.articles, recitals: data.recitals, annexes: data.annexes }}
                  onPrevNext={onPrevNext}
                  className="w-full h-full"
                />
              </div>
            </div>

            <div className={`space-y-4 ${mobileMenuOpen ? "block" : "hidden md:block"}`}>
              {/* Quick Navigation */}
              <div>
                <div className="px-1 mb-2 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-200">Quick Navigation</span>
                  <div className="group relative">
                    <Info size={14} className="text-gray-400 cursor-help" />
                    <div className="absolute left-0 top-full mt-2 w-48 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                      Use arrow keys (←/→) or swipe on mobile to navigate between articles/recitals/annexes.
                    </div>
                  </div>
                </div>

                {/* Desktop Navigation */}
                <div className="hidden md:block mb-4">
                  <NavigationControls
                    selected={selected}
                    lists={{ articles: data.articles, recitals: data.recitals, annexes: data.annexes }}
                    onPrevNext={onPrevNext}
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col gap-3">
                  {data.articles?.length > 0 && (
                    <NumberSelector
                      label="Article"
                      total={data.articles.length}
                      onSelect={(n) => {
                        const idx = data.articles.findIndex(a => parseInt(a.article_number) === n);
                        if (idx !== -1) selectArticleIdx(idx);
                        else selectArticleIdx(n - 1);
                        setMobileMenuOpen(false);
                      }}
                    />
                  )}

                  {data.recitals?.length > 0 && (
                    <NumberSelector
                      label="Recital"
                      total={data.recitals.length}
                      onSelect={(n) => {
                        selectRecitalIdx(n - 1);
                        setMobileMenuOpen(false);
                      }}
                    />
                  )}

                  {data.annexes?.length > 0 && (
                    <NumberSelector
                      label="Annex"
                      total={data.annexes.length}
                      onSelect={(n) => {
                        selectAnnexIdx(n - 1);
                        setMobileMenuOpen(false);
                      }}
                    />
                  )}
                </div>
              </div>

              {/* TOC */}
              <div className="pt-2">
                <div className="px-1 mb-2 text-sm font-semibold text-gray-900">
                  Table of Contents
                </div>
                {loading ? (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
                    Loading the table of contents...
                  </div>
                ) : loadError && !hasLoadedContent ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                    The law content is unavailable right now.
                  </div>
                ) : toc.length > 0 ? (
                  <div className="space-y-2">
                    {toc.map((ch) => {
                      const isOpen = openChapter === ch.label;
                      return (
                        <Accordion
                          key={ch.label}
                          title={ch.label || "(Untitled Chapter)"}
                          isOpen={isOpen}
                          onToggle={() => setOpenChapter(isOpen ? null : ch.label)}
                        >
                          {ch.items?.length > 0 && (
                            <ul className="space-y-1">
                              {ch.items.map((a) => (
                                <li key={`toc-${a.article_number}`}>
                                  <Button
                                    variant="ghost"
                                    className={`w-full justify-start text-left ${selected.kind === "article" && selected.id === a.article_number
                                      ? "bg-blue-50 text-blue-700"
                                      : ""
                                      }`}
                                    onClick={() => {
                                      onClickArticle(a);
                                      setMobileMenuOpen(false);
                                    }}
                                  >
                                    <span className="truncate text-left w-full">
                                      <span className="font-medium">Art. {a.article_number}</span>
                                      {a.article_title && (
                                        <span className="ml-1 text-gray-500 font-normal opacity-80 dark:text-gray-400 dark:opacity-100">
                                          - {a.article_title}
                                        </span>
                                      )}
                                    </span>
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          )}

                          {ch.sections?.map((sec) => (
                            <div key={sec.label} className="mt-3">
                              <div className="border-t border-gray-100 pt-2 pb-1 px-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                {sec.label}
                              </div>
                              <ul className="space-y-1">
                                {sec.items.map((a) => (
                                  <li key={`toc-${a.article_number}`}>
                                    <Button
                                      variant="ghost"
                                      className={`w-full justify-start text-left ${selected.kind === "article" && selected.id === a.article_number
                                        ? "bg-blue-50 text-blue-700"
                                        : ""
                                        }`}
                                      onClick={() => {
                                        onClickArticle(a);
                                        setMobileMenuOpen(false);
                                      }}
                                    >
                                      <span className="truncate text-left w-full">
                                        <span className="font-medium">Art. {a.article_number}</span>
                                        {a.article_title && (
                                          <span className="ml-1 text-gray-500 font-normal opacity-80 dark:text-gray-400 dark:opacity-100">
                                            - {a.article_title}
                                          </span>
                                        )}
                                      </span>
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </Accordion>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-4 text-sm text-gray-500 text-center">No articles available.</div>
                )}
              </div>

              {externalLawOverview.length > 0 && (
                <div className="pt-4">
                  <div className="px-1 mb-2 text-sm font-semibold text-gray-900 dark:text-gray-200">
                    Linked Legislation
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {externalLawOverview.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleOpenExternalLaw(item.ref)}
                        className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900 transition hover:border-blue-400 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100 dark:hover:border-blue-700 dark:hover:bg-blue-950/70"
                      >
                        <span className="max-w-[220px] truncate">{item.label}</span>
                        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/70 dark:text-blue-200">
                          {item.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>

      <PrintModal
        isOpen={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        onPrint={(opts) => setPrintOptions(opts)}
        counts={{
          articles: data.articles?.length || 0,
          recitals: data.recitals?.length || 0,
          annexes: data.annexes?.length || 0,
        }}
      />
    </div>
  );
}
