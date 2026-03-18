import React, { useEffect, useMemo, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Info, Loader2, Menu, RefreshCw } from "lucide-react";

import { parseFormexToCombined } from "../utils/parsers.js";
import { buildEurlexCelexUrl, buildEurlexOjUrl, buildEurlexSearchUrl } from "../utils/url.js";
import { mapRecitalsToArticles, NLP_VERSION } from "../utils/nlp.js";
import { injectDefinitionTooltips } from "../utils/definitions.js";
import { fetchFormex, FormexApiError, resolveEurlexUrl, resolveOfficialReference } from "../utils/formexApi.js";
import { parseOfficialReference } from "../utils/officialReferences.js";
import { getImportedLaws, upsertImportedLaw } from "../utils/library.js";
import { buildImportedLawCandidate, findBundledLawByCelex, findBundledLawByKey, findBundledLawBySlug, getCanonicalLawRoute, parseOfficialReferenceSlug } from "../utils/lawRouting.js";

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

function isMissingStructuredLawText(error) {
  if (!(error instanceof FormexApiError)) return false;

  const message = String(error.message || "").toLowerCase();
  return (
    error.status === 404 ||
    error.code === "fmx_not_found" ||
    error.code === "law_not_found" ||
    (
      (message.includes("fmx") || message.includes("formex")) &&
      (message.includes("not found") || message.includes("available"))
    )
  );
}

function getLoadErrorDetails(error) {
  if (isMissingStructuredLawText(error)) {
    return {
      title: "This law is not available here yet",
      message: "We couldn't find the structured text version we use to display this law in LegalViz. The law itself may still be available on EUR-Lex.",
      fallbackUrl: error.fallback?.url || error.details?.fallback?.url || null,
      status: error.status || null,
      tone: "notice",
    };
  }

  if (error instanceof FormexApiError) {
    return {
      title: "Law could not be loaded",
      message: error.message || "The law could not be loaded from the Formex service.",
      fallbackUrl: error.fallback?.url || error.details?.fallback?.url || null,
      status: error.status || null,
      tone: "error",
    };
  }

  return {
    title: "Law could not be loaded",
    message: String(error?.message || error || "The law could not be loaded."),
    fallbackUrl: null,
    status: null,
    tone: "error",
  };
}

export function LawViewer() {
  const { slug, key, kind, id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const importCelex = searchParams.get("celex");
  const sourceUrl = searchParams.get("sourceUrl");
  const isImportRoute = location.pathname === "/import" || location.pathname.startsWith("/import/");
  const isLegacyLawRoute = location.pathname.startsWith("/law/");
  const isLegacyExtensionRoute = location.pathname === "/extension" || location.pathname.startsWith("/extension/");
  const [data, setData] = useState(EMPTY_LAW_DATA);
  const [recitalMap, setRecitalMap] = useState(new Map());
  const [selected, setSelected] = useState({ kind: "article", id: null, html: "" });
  const [_returnToArticle, setReturnToArticle] = useState(null); // { id: string, title: string } | null
  const [openChapter, setOpenChapter] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
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
    localStorage.setItem("legalviz-formex-lang", formexLang);
  }, [formexLang]);

  const onIncreaseFont = () => setFontScale(s => Math.min(s + 1, 5));
  const onDecreaseFont = () => setFontScale(s => Math.max(s - 1, 1));
  const onToggleSidebar = () => setIsSidebarOpen(s => !s);
  const currentContentLang = formexLang;
  const loadErrorTone = loadError?.tone === "notice" ? "notice" : "error";
  const loadErrorPanelClass = loadErrorTone === "notice"
    ? "border-sky-200 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/20"
    : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30";
  const loadErrorTitleClass = loadErrorTone === "notice"
    ? "text-sky-950 dark:text-sky-100"
    : "text-red-900 dark:text-red-200";
  const loadErrorBodyClass = loadErrorTone === "notice"
    ? "text-sky-900 dark:text-sky-200"
    : "text-red-700 dark:text-red-300";
  const storedImportedLaws = getImportedLaws();
  const bundledLaw = useMemo(() => findBundledLawBySlug(slug) || findBundledLawByKey(key), [slug, key]);
  const celexMatchedBundledLaw = useMemo(() => findBundledLawByCelex(importCelex), [importCelex]);
  const celexMatchedImportedLaw = useMemo(() => {
    if (!importCelex || celexMatchedBundledLaw) return null;
    return storedImportedLaws.find((entry) => entry.celex === importCelex) || null;
  }, [importCelex, celexMatchedBundledLaw, storedImportedLaws]);
  const storedImportedLaw = useMemo(() => {
    if (celexMatchedImportedLaw) return celexMatchedImportedLaw;
    if (!slug || bundledLaw) return null;
    return storedImportedLaws.find((entry) => entry.slug === slug) || null;
  }, [slug, bundledLaw, storedImportedLaws, celexMatchedImportedLaw]);
  const slugReference = useMemo(() => {
    if (!slug || bundledLaw || storedImportedLaw || celexMatchedBundledLaw) return null;
    return parseOfficialReferenceSlug(slug);
  }, [slug, bundledLaw, storedImportedLaw, celexMatchedBundledLaw]);
  const derivedSlugLaw = useMemo(() => {
    if (!slugReference) return null;
    return buildImportedLawCandidate({ officialReference: slugReference, slug });
  }, [slugReference, slug]);
  const currentLaw = useMemo(() => (
    celexMatchedBundledLaw || bundledLaw || storedImportedLaw || derivedSlugLaw || null
  ), [celexMatchedBundledLaw, bundledLaw, storedImportedLaw, derivedSlugLaw]);
  const currentCelex = importCelex || currentLaw?.celex || null;
  const currentLawSlug = currentLaw?.slug || null;
  const canonicalRoute = useMemo(() => {
    if (isLegacyExtensionRoute || !currentLawSlug) return null;
    return getCanonicalLawRoute(currentLaw, kind, id);
  }, [currentLaw, currentLawSlug, kind, id, isLegacyExtensionRoute]);

  const navigateToCanonical = useCallback((kindName, targetId, options = {}) => {
    if (!currentLawSlug) return;
    navigate(getCanonicalLawRoute(currentLaw, kindName, targetId), options);
  }, [currentLaw, currentLawSlug, navigate]);

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

  const loadLaw = React.useCallback(async (celex, lang) => {
    if (!celex) return;
    setLoading(true);
    setLoadError(null);
    setData(EMPTY_LAW_DATA);
    setSelected({ kind: "article", id: null, html: "" });
    setReturnToArticle(null);
    try {
      const text = await fetchFormex(celex, lang);
      const combined = parseFormexToCombined(text);
      setData(combined);
    } catch (e) {
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
      if (currentLaw?.slug) {
        cacheKey = `nlp_v${NLP_VERSION}_${currentLaw.slug}_fmx_${formexLang}`;
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
  }, [data.articles, data.recitals, currentLawSlug, currentLaw, formexLang]);


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
        const resolvedReference = result?.parsed?.reference || null;
        if (resolvedReference?.actType && resolvedReference?.year && resolvedReference?.number) {
          const target = buildImportedLawCandidate({
            celex: resolvedCelex,
            officialReference: resolvedReference,
          });
          navigate(getCanonicalLawRoute(target), { replace: true });
          return;
        }
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

  useEffect(() => {
    if (isLegacyExtensionRoute || !canonicalRoute) return;
    if (isLegacyLawRoute || (isImportRoute && currentCelex && currentLawSlug)) {
      navigate(canonicalRoute, { replace: true });
    }
  }, [canonicalRoute, currentCelex, currentLawSlug, isLegacyExtensionRoute, isImportRoute, isLegacyLawRoute, navigate]);

  useEffect(() => {
    if (isLegacyExtensionRoute || currentCelex || !slugReference) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    resolveOfficialReference(slugReference, formexLang)
      .then((result) => {
        if (cancelled) return;
        const resolvedCelex = result?.resolved?.celex;
        if (!resolvedCelex) {
          setLoadError({
            message: "This law reference could not be resolved automatically.",
            fallbackUrl: result?.fallback?.url || buildEurlexSearchUrl(`${slugReference.actType} ${slugReference.year}/${slugReference.number}`, formexLang),
            status: result?.status || null,
          });
          setLoading(false);
          return;
        }
        loadLaw(resolvedCelex, formexLang);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(getLoadErrorDetails(error));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slugReference, currentCelex, formexLang, loadLaw, isLegacyExtensionRoute]);

  // Load law when path/formex settings change
  useEffect(() => {
    if (isLegacyExtensionRoute) return;
    if (sourceUrl && !currentCelex) return;
    if (!currentCelex && slugReference) return;

    if (currentCelex) {
      loadLaw(currentCelex, formexLang);
    } else if (key || slug) {
      navigate("/", { replace: true });
    }
  }, [key, slug, loadLaw, navigate, isLegacyExtensionRoute, currentCelex, formexLang, loadAttempt, sourceUrl, slugReference]);

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
      if (data.articles?.[0]) {
        const a0 = data.articles[0];
        setSelected({ kind: "article", id: a0.article_number, html: a0.article_html });
        navigateToCanonical("article", a0.article_number, { replace: true });
      } else if (data.recitals?.[0]) {
        const r0 = data.recitals[0];
        setSelected({ kind: "recital", id: r0.recital_number, html: r0.recital_html });
        navigateToCanonical("recital", r0.recital_number, { replace: true });
      } else if (data.annexes?.[0]) {
        const x0 = data.annexes[0];
        setSelected({ kind: "annex", id: x0.annex_id, html: x0.annex_html });
        navigateToCanonical("annex", x0.annex_id, { replace: true });
      }
    }
  }, [data, kind, id, navigateToCanonical]);

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

  const selectArticleIdx = useCallback((idx) => {
    const a = data.articles[idx];
    if (!a) return;
    setSelected({ kind: "article", id: a.article_number, html: a.article_html });
    navigateToCanonical("article", a.article_number);
  }, [data.articles, navigateToCanonical]);
  const selectRecitalIdx = useCallback((idx) => {
    const r = data.recitals[idx];
    if (!r) return;
    setSelected({ kind: "recital", id: r.recital_number, html: r.recital_html });
    navigateToCanonical("recital", r.recital_number);
  }, [data.recitals, navigateToCanonical]);
  const selectAnnexIdx = useCallback((idx) => {
    const x = data.annexes[idx];
    if (!x) return;
    setSelected({ kind: "annex", id: x.annex_id, html: x.annex_html });
    navigateToCanonical("annex", x.annex_id);
  }, [data.annexes, navigateToCanonical]);

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
      if (currentLaw?.label) {
        lawName = currentLaw.label;
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
  }, [currentLaw, selected.kind, selected.id, data.title]);

  const eurlexUrl = useMemo(() => {
    if (sourceUrl) return sourceUrl;
    if (currentCelex) return buildEurlexCelexUrl(currentCelex, formexLang);
    return currentLaw?.eurlex || null;
  }, [currentLaw, currentCelex, formexLang, sourceUrl]);

  const hasLoadedContent = data.articles.length > 0 || data.recitals.length > 0 || data.annexes.length > 0;
  const currentLawLabel = useMemo(() => {
    if (data.title) return data.title;
    if (searchParams.get("raw")) return searchParams.get("raw");
    if (currentLaw?.label) return currentLaw.label;
    if (slugReference) return `${slugReference.actType} ${slugReference.year}/${slugReference.number}`;
    return "";
  }, [data.title, searchParams, currentLaw, slugReference]);

  useEffect(() => {
    if (isLegacyExtensionRoute || !currentCelex || !hasLoadedContent) return;

    const rawReference = searchParams.get("raw");
    const officialReference = currentLaw?.officialReference || parseOfficialReference(rawReference || "");
    const importedLaw = upsertImportedLaw({
      celex: currentCelex,
      raw: rawReference,
      officialReference,
      label: rawReference || data.title || currentLaw?.label || "Imported law",
      eurlex: buildEurlexCelexUrl(currentCelex, formexLang),
    });

    if (!importedLaw?.id) return;

    try {
      const stored = localStorage.getItem("eurlex_last_opened");
      const existing = stored ? JSON.parse(stored) : {};
      const now = Date.now();
      existing[importedLaw.id] = now;
      existing[currentCelex] = now;
      localStorage.setItem("eurlex_last_opened", JSON.stringify(existing));
    } catch {
      // ignore localStorage failures
    }
  }, [isLegacyExtensionRoute, currentCelex, currentLaw, hasLoadedContent, searchParams, data.title, formexLang]);

  const retryLoad = useCallback(() => {
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  const loadingMessage = useMemo(() => {
    return `Loading ${currentLawLabel || "law"}...`;
  }, [currentLawLabel]);

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

  const hasCelex = !!currentCelex;
  const isLegacyExtensionQuery = searchParams.get("extension") === "true" || !!searchParams.get("key");
  const showLegacyMigrationNotice = isLegacyExtensionRoute || isLegacyExtensionQuery;

  const handleRetrySupportedImport = useCallback(() => {
    if (!sourceUrl) return;
    navigate(`/import?sourceUrl=${encodeURIComponent(sourceUrl)}`, { replace: true });
  }, [navigate, sourceUrl]);

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
        const targetLaw = buildImportedLawCandidate({
          celex: result.resolved.celex,
          officialReference: reference,
        });
        navigate(getCanonicalLawRoute(targetLaw));
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
  }, [resolveReferenceInput, currentContentLang, openFallbackReference, navigate]);

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
          lawKey={currentLaw?.slug || slug || key || "import"}
          title={currentLawLabel}
          lists={{ articles: data.articles, recitals: data.recitals, annexes: data.annexes }}
          isExtensionMode={false}
          eurlexUrl={eurlexUrl}
          onPrint={() => setPrintModalOpen(true)}
          onToggleSidebar={onToggleSidebar}
          isSidebarOpen={isSidebarOpen}
          onIncreaseFont={onIncreaseFont}
          onDecreaseFont={onDecreaseFont}
          fontSize={getFontPercent(fontScale)}
          formexLang={formexLang}
          onFormexLangChange={setFormexLang}
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
              ) : showLegacyMigrationNotice ? (
                <div className="flex min-h-[30vh] flex-col items-center justify-center text-center">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-8 dark:border-amber-900 dark:bg-amber-950/30">
                    <h2 className="text-2xl font-bold font-serif text-amber-900 dark:text-amber-200">
                      Extension update needed
                    </h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-amber-800 dark:text-amber-300">
                      LegalViz now imports laws through a new Formex-based flow. This older extension entrypoint is no longer supported, so please update your browser extension and try again.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                      {sourceUrl && (
                        <Button type="button" onClick={handleRetrySupportedImport}>
                          Retry import
                        </Button>
                      )}
                      {eurlexUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => window.open(eurlexUrl, "_blank", "noopener,noreferrer")}
                        >
                          Open on EUR-Lex
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => navigate("/", { replace: true })}
                      >
                        Go to homepage
                      </Button>
                    </div>
                  </div>
                </div>
              ) : loadError && !hasLoadedContent ? (
                <div className="flex min-h-[30vh] flex-col items-center justify-center text-center">
                  <div className={`rounded-2xl border px-6 py-8 ${loadErrorPanelClass}`}>
                    <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${loadErrorTone === "notice" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200" : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200"}`}>
                      <Info size={22} />
                    </div>
                    <h2 className={`mt-4 text-2xl font-bold font-serif ${loadErrorTitleClass}`}>
                      {loadError.title}
                    </h2>
                    <p className={`mt-3 max-w-xl text-sm leading-6 ${loadErrorBodyClass}`}>
                      {loadError.message}
                    </p>
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                      {eurlexUrl && (
                        <Button
                          type="button"
                          className={loadErrorTone === "notice" ? "border border-sky-700 bg-sky-700 text-white hover:bg-sky-800 dark:border-sky-300 dark:bg-sky-300 dark:text-sky-950 dark:hover:bg-sky-200" : ""}
                          onClick={() => window.open(loadError.fallbackUrl || eurlexUrl, "_blank", "noopener,noreferrer")}
                        >
                          Try on EUR-Lex
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        className={loadErrorTone === "notice" ? "border-sky-200 bg-white text-sky-900 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/10 dark:text-sky-100 dark:hover:bg-sky-900/30" : ""}
                        onClick={retryLoad}
                      >
                        <RefreshCw size={16} />
                        Reload here
                      </Button>
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
                  currentLang={formexLang}
                  onOpenExternalReference={handleOpenExternalLaw}
                />
                <RelatedRecitals
                  recitals={recitalMap.get(selected.id) || []}
                  allRecitals={data.recitals}
                  onSelectRecital={(r) => onClickRecital(r, selected.id)}
                />
              </>
            )}

            {selected.kind === "annex" && (
              <CrossReferences
                entryKey={`annex_${selected.id}`}
                crossReferences={data.crossReferences}
                articles={data.articles}
                onSelectArticle={onCrossRefArticle}
                itemLabel="annex"
                showBackReferences={false}
                currentLang={formexLang}
                onOpenExternalReference={handleOpenExternalLaw}
              />
            )}

            {loadError && hasLoadedContent && (
              <div className={`mt-4 rounded-2xl border p-4 text-sm ${loadErrorTone === "notice" ? "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200" : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"}`}>
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
                  <div className={`rounded-2xl border p-4 text-sm ${loadErrorTone === "notice" ? "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200" : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"}`}>
                    {loadErrorTone === "notice"
                      ? "The structured LegalViz version of this law is not available right now."
                      : "The law content is unavailable right now."}
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
                  <Accordion
                    title={`Linked Legislation (${externalLawOverview.length})`}
                    defaultOpen={false}
                  >
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
                  </Accordion>
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
