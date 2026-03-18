import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Github, Trash, Clock } from "lucide-react";
import { TopBar } from "./TopBar.jsx";
import { SEO } from "./SEO.jsx";
import { AppResetFooter } from "./AppResetFooter.jsx";
import { parseFormexToCombined } from "../utils/parsers.js";
import { FormexApiError, getCachedFormex, resolveOfficialReference } from "../utils/formexApi.js";
import { getImportedLaws, getLibraryLaws } from "../utils/library.js";
import { buildImportedLawCandidate, getCanonicalLawRoute } from "../utils/lawRouting.js";
import { useI18n } from "../i18n/I18nProvider.jsx";

export function Landing({ forcedLocale = null }) {
  const navigate = useNavigate();
  const { locale, setLocale, localizePath, t } = useI18n();
  const [instructionsDismissed, setInstructionsDismissed] = useState(() => {
    try {
      return localStorage.getItem('eurlex_instructions_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  const [showExtensionInfo, setShowExtensionInfo] = useState(false);

  const dismissInstructions = (e) => {
    e.stopPropagation();
    setInstructionsDismissed(true);
    setShowExtensionInfo(false);
    localStorage.setItem('eurlex_instructions_dismissed', 'true');
  };

  const [hiddenLaws, setHiddenLaws] = useState(() => {
    try {
      const stored = localStorage.getItem('eurlex_hidden_laws');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [lastOpened, setLastOpened] = useState(() => {
    try {
      const stored = localStorage.getItem('eurlex_last_opened');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [importedLawsVersion, setImportedLawsVersion] = useState(() => getImportedLaws().length);
  const [formexLang, setFormexLang] = useState(() => {
    try {
      return localStorage.getItem("legalviz-formex-lang") || "EN";
    } catch {
      return "EN";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("legalviz-formex-lang", formexLang);
    } catch {
      // ignore localStorage failures
    }
  }, [formexLang]);

  // State for global search
  const [allLawsData, setAllLawsData] = useState({ articles: [], recitals: [], annexes: [] });
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [searchableLawCount, setSearchableLawCount] = useState(0);
  const searchLoadInFlightRef = useRef(false);
  const [referenceType, setReferenceType] = useState("directive");
  const [referenceYear, setReferenceYear] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (forcedLocale && forcedLocale !== locale) {
      setLocale(forcedLocale);
    }
  }, [forcedLocale, locale, setLocale]);

  const handleSearchOpen = useCallback(async () => {
    if (searchLoadInFlightRef.current) return;

    searchLoadInFlightRef.current = true;
    setIsSearchLoading(true);
    try {
      const combined = { articles: [], recitals: [], annexes: [] };
      const libraryLaws = getLibraryLaws({ hiddenLaws, lastOpened, importedLawsVersion });

      const standardPromises = libraryLaws.map(async (law) => {
        try {
          if (!law.celex) return null;

          const text = await getCachedFormex(law.celex, formexLang);
          if (!text) return null;

          const parsed = parseFormexToCombined(text);
          const metadata = {
            routeKind: law.kind === "imported" ? "imported" : "bundled",
            law_key: law.key || null,
            law_slug: law.slug || null,
            celex: law.celex,
            raw: law.raw || null,
            langCode: parsed.langCode || formexLang,
          };

          parsed.articles?.forEach(a => {
            a.law_key = law.id;
            a.law_label = law.label;
            Object.assign(a, metadata);
          });
          parsed.recitals?.forEach(r => {
            r.law_key = law.id;
            r.law_label = law.label;
            Object.assign(r, metadata);
          });
          parsed.annexes?.forEach(a => {
            a.law_key = law.id;
            a.law_label = law.label;
            Object.assign(a, metadata);
          });

          return parsed;
        } catch (e) {
          console.error(`Failed to load law ${law.key} for search index`, e);
          return null;
        }
      });

      const standardResults = await Promise.allSettled(standardPromises);

      standardResults.forEach((res) => {
        if (res.status === 'fulfilled' && res.value) {
          combined.articles.push(...(res.value.articles || []));
          combined.recitals.push(...(res.value.recitals || []));
          combined.annexes.push(...(res.value.annexes || []));
        }
      });

      setAllLawsData(combined);
      const searchableIds = new Set(combined.articles.map((entry) => entry.celex).filter(Boolean));
      combined.recitals.forEach((entry) => {
        if (entry.celex) searchableIds.add(entry.celex);
      });
      combined.annexes.forEach((entry) => {
        if (entry.celex) searchableIds.add(entry.celex);
      });
      setSearchableLawCount(searchableIds.size);
    } catch (e) {
      console.error("Error loading search data", e);
    } finally {
      searchLoadInFlightRef.current = false;
      setIsSearchLoading(false);
    }
  }, [formexLang, hiddenLaws, importedLawsVersion, lastOpened]);

  // Update document title
  // Handled by SEO component

  // Save last opened update when clicking a law
  const handleLawClick = (key) => {
    const now = Date.now();
    const newLastOpened = { ...lastOpened, [key]: now };
    setLastOpened(newLastOpened);
    localStorage.setItem('eurlex_last_opened', JSON.stringify(newLastOpened));
  };

  const handleDelete = (e, key) => {
    e.stopPropagation();
    if (window.confirm(t("landing.deleteConfirm"))) {
      const newHidden = [...hiddenLaws, key];
      setHiddenLaws(newHidden);
      localStorage.setItem('eurlex_hidden_laws', JSON.stringify(newHidden));
      setAllLawsData({ articles: [], recitals: [], annexes: [] });
      setSearchableLawCount(0);
    }
  };

  useEffect(() => {
    const syncLibrary = () => {
      setImportedLawsVersion(getImportedLaws().length);
      try {
        setFormexLang(localStorage.getItem("legalviz-formex-lang") || "EN");
      } catch {
        setFormexLang("EN");
      }
      try {
        const storedHidden = localStorage.getItem('eurlex_hidden_laws');
        setHiddenLaws(storedHidden ? JSON.parse(storedHidden) : []);
      } catch {
        setHiddenLaws([]);
      }
      try {
        const storedOpened = localStorage.getItem('eurlex_last_opened');
        setLastOpened(storedOpened ? JSON.parse(storedOpened) : {});
      } catch {
        setLastOpened({});
      }
    };

    window.addEventListener("focus", syncLibrary);
    window.addEventListener("storage", syncLibrary);
    window.addEventListener("legalviz-formex-cache-updated", syncLibrary);
    return () => {
      window.removeEventListener("focus", syncLibrary);
      window.removeEventListener("storage", syncLibrary);
      window.removeEventListener("legalviz-formex-cache-updated", syncLibrary);
    };
  }, []);

  useEffect(() => {
    setAllLawsData({ articles: [], recitals: [], annexes: [] });
    setSearchableLawCount(0);
  }, [hiddenLaws, importedLawsVersion, formexLang]);

  const formatDate = (ts) => {
    if (!ts) return t("landing.never");
    return new Date(ts).toLocaleString(forcedLocale || locale, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const handleReferenceImport = async (e) => {
    e.preventDefault();
    setImportError("");

    const year = referenceYear.trim();
    const number = referenceNumber.trim();
    if (!/^\d{4}$/.test(year) || !/^\d{1,4}$/.test(number)) {
      setImportError(t("landing.invalidReference"));
      return;
    }

    const parsed = {
      actType: referenceType,
      year,
      number,
      raw: `${referenceType[0].toUpperCase()}${referenceType.slice(1)} ${year}/${number}`,
    };

    setIsImporting(true);
    try {
      const result = await resolveOfficialReference(parsed, "EN");
      if (result?.resolved?.celex) {
        const importedLaw = buildImportedLawCandidate({
          celex: result.resolved.celex,
          officialReference: parsed,
        });
        navigate(getCanonicalLawRoute(importedLaw, null, null, locale));
        return;
      }

      const fallbackUrl = result?.fallback?.url;
      if (fallbackUrl) {
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
        setImportError(t("landing.automaticImportFallback"));
        return;
      }

      setImportError(t("landing.importUnavailable"));
    } catch (err) {
      const fallbackUrl = err instanceof FormexApiError
        ? err.fallback?.url || err.details?.fallback?.url
        : null;

      if (fallbackUrl) {
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
        setImportError(t("landing.automaticImportFallback"));
      } else {
        setImportError(t("landing.importUnavailable"));
      }
    } finally {
      setIsImporting(false);
    }
  };

  const allLaws = getLibraryLaws({ hiddenLaws, lastOpened, importedLawsVersion });

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-900 transition-colors duration-500">
      <SEO
        description={t("seo.landingDescription")}
      />
      <TopBar
        lawKey=""
        title=""
        lists={allLawsData}
        isExtensionMode={false}
        eurlexUrl={null}
        showPrint={false}
        onSearchOpen={handleSearchOpen}
        isSearchLoading={isSearchLoading}
        formexLang={formexLang}
        searchableLawCount={searchableLawCount}
        onFormexLangChange={setFormexLang}
        hasCelex={true}
      />

      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col items-center justify-center px-6 py-10">
        <Motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium tracking-tight text-gray-700 ring-1 ring-gray-200 mb-6 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
            <span>{t("app.name")}</span>
            <span className="mx-2 text-gray-400 dark:text-gray-500">|</span>
            <span className="font-normal text-gray-500 dark:text-gray-400">{t("app.tagline")}</span>
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl dark:text-white">
            {t("landing.heroTitle")}
            <span className="block text-gray-600 dark:text-gray-400">{t("landing.heroSubtitle")}</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-gray-600 sm:text-base dark:text-gray-400">
            {t("landing.heroDescription")}
          </p>
        </Motion.div>

        <Motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mt-8 w-full"
        >
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
            {t("landing.option1")}
          </h2>
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:bg-gray-900 dark:border-gray-800">
            <form onSubmit={handleReferenceImport} className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
              <select
                value={referenceType}
                onChange={(e) => setReferenceType(e.target.value)}
                className="min-w-0 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-blue-700 dark:focus:ring-blue-950"
              >
                <option value="directive">{t("landing.directive")}</option>
                <option value="regulation">{t("landing.regulation")}</option>
                <option value="decision">{t("landing.decision")}</option>
              </select>
              <input
                type="text"
                inputMode="numeric"
                value={referenceYear}
                onChange={(e) => setReferenceYear(e.target.value)}
                placeholder={t("landing.year")}
                className="min-w-0 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-blue-700 dark:focus:ring-blue-950"
              />
              <input
                type="text"
                inputMode="numeric"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder={t("landing.number")}
                className="min-w-0 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-blue-700 dark:focus:ring-blue-950"
              />
              <button
                type="submit"
                disabled={isImporting}
                className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                {isImporting ? t("landing.importing") : t("landing.importLaw")}
              </button>
            </form>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {t("landing.importHelper")}
            </p>
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              {t("landing.example")}
            </div>
            {importError && (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {importError}
              </p>
            )}
          </div>
        </Motion.div>

        <Motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mt-8 w-full"
        >
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
            {t("landing.option2")}
          </h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {allLaws.map((law) => (
              <Motion.div
                key={law.id}
                whileHover={{ y: -2, scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => {
                  handleLawClick(law.id);
                  navigate(localizePath(law.route, locale));
                }}

                className="group relative flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-gray-300 hover:shadow-md cursor-pointer dark:bg-gray-900 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:shadow-gray-900/50"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleLawClick(law.id);
                    navigate(localizePath(law.route, locale));
                  }
                }}
                role="button"
              >
                <div className="flex items-start justify-between gap-2 w-full">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate pr-6 dark:text-gray-100">
                      {law.label}
                    </div>


                    <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-400">
                      <Clock className="h-3 w-3" />
                      <span>{t("common.lastOpened", { date: formatDate(law.timestamp) })}</span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDelete(e, law.id)}
                    className="absolute top-4 right-4 p-1.5 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 transition-all"
                    title={t("common.hideLaw")}
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                </div>
              </Motion.div>
            ))}
          </div>
        </Motion.div>

        {
          !instructionsDismissed && (
            <Motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mt-10 w-full"
            >
                <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                {t("landing.option3")}
              </h2>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm dark:bg-gray-900 dark:border-gray-800">
                <div className="flex w-full items-center justify-between px-6 py-4 text-left">
                  <button
                    type="button"
                    onClick={() => setShowExtensionInfo((prev) => !prev)}
                    className="flex flex-1 items-center justify-between mr-4"
                  >
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {t("landing.visualiseStepsTitle")}
                    </p>
                    <Motion.span
                      animate={{ rotate: showExtensionInfo ? 90 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-xl text-gray-600 shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400"
                    >
                      ❯
                    </Motion.span>
                  </button>

                  <button
                    onClick={dismissInstructions}
                    className="text-xs text-gray-400 hover:text-red-500 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    title={t("landing.dismissInstructions")}
                  >
                    {t("common.dismiss")}
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {showExtensionInfo && (
                    <Motion.div
                      initial="collapsed"
                      animate="open"
                      exit="collapsed"
                      variants={{
                        open: { height: "auto", opacity: 1 },
                        collapsed: { height: 0, opacity: 0 },
                      }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-4 border-t border-gray-100 px-6 pb-6 pt-4 text-xs dark:border-gray-800">
                        <p className="text-gray-700 dark:text-gray-300">
                          {t("landing.extensionDescription")}
                        </p>

                        <div>
                          <p className="mb-3 font-medium text-gray-700 dark:text-gray-300">{t("landing.installExtension")}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href="https://chrome.google.com/webstore/detail/eur-lex-visualiser/akkfdjadggheloggnfonppfkbifanpbc"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50 hover:shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                              <span className="text-base">🌐</span>
                              <span>Chrome</span>
                            </a>
                            <a
                              href="https://chrome.google.com/webstore/detail/eur-lex-visualiser/akkfdjadggheloggnfonppfkbifanpbc"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50 hover:shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                              <span className="text-base">🦁</span>
                              <span>Brave</span>
                            </a>
                            <a
                              href="https://chrome.google.com/webstore/detail/eur-lex-visualiser/akkfdjadggheloggnfonppfkbifanpbc"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50 hover:shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                              <span className="text-base">🔷</span>
                              <span>Edge</span>
                            </a>
                            <a
                              href="https://addons.mozilla.org/en-US/firefox/addon/eur-lex-visualiser/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-3 py-1.5 font-medium text-gray-700 transition hover:bg-orange-50 hover:shadow-sm dark:bg-gray-800 dark:border-orange-900/50 dark:text-gray-200 dark:hover:bg-orange-900/20"
                            >
                              <span className="text-base">🦊</span>
                              <span>Firefox</span>
                            </a>
                          </div>
                        </div>

                        <div className="rounded-lg bg-white p-3 dark:bg-gray-800/50">
                          <p className="font-medium text-gray-900 dark:text-white">{t("landing.howItWorks")}</p>
                          <ol className="mt-2 space-y-1.5 text-gray-700 dark:text-gray-300">
                            <li className="flex gap-2">
                              <span className="font-semibold text-gray-500">1.</span>
                              <span>{t("landing.step1")}</span>
                            </li>
                            <li className="flex gap-2">
                              <span className="font-semibold text-gray-500">2.</span>
                              <span>
                                {t("landing.step2")}{" "}
                                (e.g.{" "}
                                <a
                                  href="https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="break-all text-blue-600 hover:underline"
                                >
                                  https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
                                </a>
                                )
                              </span>
                            </li>
                            <li className="flex gap-2">
                              <span className="font-semibold text-gray-500">3.</span>
                              <span>{t("landing.step3")}</span>
                            </li>
                            <li className="mt-2">
                              <img
                                src={`${import.meta.env.BASE_URL}language-selector.png`}
                                alt={t("landing.installExtension")}
                                className="w-full rounded-lg border border-gray-200 shadow-sm"
                              />
                            </li>
                            <li className="flex gap-2">
                              <span className="font-semibold text-gray-500">4.</span>
                              <span>{t("landing.step4")}</span>
                            </li>
                          </ol>
                        </div>

                      </div>
                    </Motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Motion.div>
          )
        }

        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mt-8 flex flex-col items-center gap-2 text-xs text-gray-500"
        >
          <p>
            {t("landing.builtBy")}
          </p>
          <a
            href="https://github.com/maastrichtlawtech/eur-lex-visualiser"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-gray-600 transition hover:text-gray-900 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <Github className="h-4 w-4" />
            <span>{t("landing.sourceCode")}</span>
          </a>
        </Motion.div>

        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mt-8"
        >
          <AppResetFooter />
        </Motion.div>
      </div >
    </div >
  );
}
