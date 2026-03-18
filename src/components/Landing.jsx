import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Github, Trash, Clock } from "lucide-react";
import { LAWS } from "../constants/laws.js";
import { TopBar } from "./TopBar.jsx";
import { SEO } from "./SEO.jsx";
import { fetchText } from "../utils/fetch.js";
import { parseAnyToCombined } from "../utils/parsers.js";
import { FormexApiError, resolveOfficialReference } from "../utils/formexApi.js";

export function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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

  const [customLaws, setCustomLaws] = useState([]);

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

  // State for global search
  const [allLawsData, setAllLawsData] = useState({ articles: [], recitals: [], annexes: [] });
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [referenceType, setReferenceType] = useState("directive");
  const [referenceYear, setReferenceYear] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const fetchCustomLaw = (key) => {
    return new Promise((resolve) => {
      const handleMsg = (event) => {
        if (event.source !== window) return;
        if (event.data.type === 'EURLEX_LAW_DATA') {
          // We blindly resolve the first LAW_DATA we get. 
          // Since we request sequentially, this should be fine.
          window.removeEventListener('message', handleMsg);
          resolve(event.data.payload);
        }
      };
      window.addEventListener('message', handleMsg);
      window.postMessage({ type: 'EURLEX_GET_LAW', key }, '*');

      // Timeout safety
      setTimeout(() => {
        window.removeEventListener('message', handleMsg);
        resolve(null);
      }, 2000);
    });
  };

  const handleSearchOpen = async () => {
    // Only load if not already loaded
    if (allLawsData.articles.length > 0) return;

    setIsSearchLoading(true);
    try {
      const combined = { articles: [], recitals: [], annexes: [] };

      // 1. Fetch Standard Laws
      const standardPromises = LAWS.map(async (law) => {
        try {
          if (hiddenLaws.includes(law.key)) return null;

          const text = await fetchText(law.value);
          const parsed = parseAnyToCombined(text);

          parsed.articles?.forEach(a => {
            a.law_key = law.key;
            a.law_label = law.label;
          });
          parsed.recitals?.forEach(r => {
            r.law_key = law.key;
            r.law_label = law.label;
          });
          parsed.annexes?.forEach(a => {
            a.law_key = law.key;
            a.law_label = law.label;
          });

          return parsed;
        } catch (e) {
          console.error(`Failed to load law ${law.key} for search index`, e);
          return null;
        }
      });

      // 2. Fetch Custom Laws (Sequentially to avoid bridge congestion/race conditions)
      // We don't block standard laws loading, but we wait for everything at the end
      const customLawResults = [];
      if (customLaws.length > 0) {
        for (const l of customLaws) {
          try {
            // Skip if hidden
            if (hiddenLaws.includes(l.key)) continue;

            const data = await fetchCustomLaw(l.key);
            if (data && data.html) {
              const parsed = parseAnyToCombined(data.html);

              // Use metadata title if available
              const title = data.metadata?.title || l.title || "Custom Law";

              parsed.articles?.forEach(a => {
                a.law_key = l.key;
                a.law_label = title;
              });
              parsed.recitals?.forEach(r => {
                r.law_key = l.key;
                r.law_label = title;
              });
              parsed.annexes?.forEach(a => {
                a.law_key = l.key;
                a.law_label = title;
              });
              customLawResults.push(parsed);
            }
          } catch (e) {
            console.error("Failed to load custom law for search", l.key, e);
          }
        }
      }

      const standardResults = await Promise.allSettled(standardPromises);

      standardResults.forEach((res) => {
        if (res.status === 'fulfilled' && res.value) {
          combined.articles.push(...(res.value.articles || []));
          combined.recitals.push(...(res.value.recitals || []));
          combined.annexes.push(...(res.value.annexes || []));
        }
      });

      customLawResults.forEach((res) => {
        combined.articles.push(...(res.articles || []));
        combined.recitals.push(...(res.recitals || []));
        combined.annexes.push(...(res.annexes || []));
      });

      setAllLawsData(combined);
    } catch (e) {
      console.error("Error loading search data", e);
    } finally {
      setIsSearchLoading(false);
    }
  };

  // Update document title
  // Handled by SEO component

  // Save last opened update when clicking a law
  const handleLawClick = (key, isCustom) => {
    // For custom laws, the timestamp is already in the law object from extension
    if (!isCustom) {
      const now = Date.now();
      const newLastOpened = { ...lastOpened, [key]: now };
      setLastOpened(newLastOpened);
      localStorage.setItem('eurlex_last_opened', JSON.stringify(newLastOpened));
    }
  };

  // Redirect to extension route if extension params are present
  useEffect(() => {
    const isExtension = searchParams.get('extension') === 'true';
    const key = searchParams.get('key');
    if (isExtension && key) {
      navigate(`/extension?extension=true&key=${key}`, { replace: true });
    }
  }, [searchParams, navigate]);

  const [isExtensionReady, setIsExtensionReady] = useState(false);

  // Poll for custom laws
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.source !== window) return;

      if (event.data.type === 'EURLEX_LAW_LIST') {
        setCustomLaws(event.data.payload.laws || []);
        setIsExtensionReady(true);
      }

      if (event.data.type === 'EURLEX_DELETE_SUCCESS') {
        // Clear search cache so it rebuilds next time
        setAllLawsData({ articles: [], recitals: [], annexes: [] });
        // Refresh list
        window.postMessage({ type: 'EURLEX_GET_LIST' }, '*');
      }

      if (event.data.type === 'EURLEX_EXTENSION_READY') {
        setIsExtensionReady(true);
        window.postMessage({ type: 'EURLEX_GET_LIST' }, '*');
      }
    };

    window.addEventListener('message', handleMessage);

    // Initial fetch
    window.postMessage({ type: 'EURLEX_GET_LIST' }, '*');

    // Poll for a bit to ensure we catch it if the extension script loads late
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (attempts > 20) clearInterval(interval); // 10 seconds
      window.postMessage({ type: 'EURLEX_GET_LIST' }, '*');
    }, 500);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(interval);
    };
  }, []);

  const handleDelete = (e, key, isCustom) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this law?")) {
      if (isCustom) {
        window.postMessage({ type: 'EURLEX_DELETE_LAW', key }, '*');
      } else {
        const newHidden = [...hiddenLaws, key];
        setHiddenLaws(newHidden);
        localStorage.setItem('eurlex_hidden_laws', JSON.stringify(newHidden));
        // Clear search cache
        setAllLawsData({ articles: [], recitals: [], annexes: [] });
      }
    }
  };

  const formatDate = (ts) => {
    if (!ts) return "Never";
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const handleReferenceImport = async (e) => {
    e.preventDefault();
    setImportError("");

    const year = referenceYear.trim();
    const number = referenceNumber.trim();
    if (!/^\d{4}$/.test(year) || !/^\d{1,4}$/.test(number)) {
      setImportError("Enter a 4-digit year and a numeric law number.");
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
        const params = new URLSearchParams({
          celex: result.resolved.celex,
          raw: parsed.raw,
        });
        navigate(`/import?${params.toString()}`);
        return;
      }

      const fallbackUrl = result?.fallback?.url;
      if (fallbackUrl) {
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
        setImportError("Automatic import was not available, so EUR-Lex search was opened in a new tab.");
        return;
      }

      setImportError("This reference could not be imported automatically.");
    } catch (err) {
      const fallbackUrl = err instanceof FormexApiError
        ? err.fallback?.url || err.details?.fallback?.url
        : null;

      if (fallbackUrl) {
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
        setImportError("Automatic import failed, so EUR-Lex search was opened in a new tab.");
      } else {
        setImportError("Could not import this law right now.");
      }
    } finally {
      setIsImporting(false);
    }
  };

  const allLaws = [
    ...customLaws.map(l => ({
      ...l,
      label: l.title,
      isCustom: true
    })),
    ...LAWS.map(l => ({
      ...l,
      isCustom: false,
      timestamp: lastOpened[l.key] || null
    }))
  ]
    .filter(l => !hiddenLaws.includes(l.key || l.value)) // Filter out hidden laws
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // Sort by last opened

  const hasCustomLaws = customLaws.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-900 transition-colors duration-500">
      <SEO
        description="Read and navigate EU laws (GDPR, AI Act, DMA, DSA) efficiently with interactive visualisations. View articles and related recitals side-by-side."
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
      />

      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col items-center justify-center px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium tracking-tight text-gray-700 ring-1 ring-gray-200 mb-6 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
            <span>LegalViz.EU</span>
            <span className="mx-2 text-gray-400 dark:text-gray-500">|</span>
            <span className="font-normal text-gray-500 dark:text-gray-400">EU Law Visualizer</span>
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl dark:text-white">
            Read EU law beautifully,
            <span className="block text-gray-600 dark:text-gray-400">and with ease.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-gray-600 sm:text-base dark:text-gray-400">
            Choose the instrument you are working with. You will then see an interactive view with
            chapters, articles, recitals, and annexes side by side.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mt-8 w-full"
        >
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
            Import by official reference
          </h2>
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:bg-gray-900 dark:border-gray-800">
            <form onSubmit={handleReferenceImport} className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
              <select
                value={referenceType}
                onChange={(e) => setReferenceType(e.target.value)}
                className="min-w-0 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-blue-700 dark:focus:ring-blue-950"
              >
                <option value="directive">Directive</option>
                <option value="regulation">Regulation</option>
                <option value="decision">Decision</option>
              </select>
              <input
                type="text"
                inputMode="numeric"
                value={referenceYear}
                onChange={(e) => setReferenceYear(e.target.value)}
                placeholder="Year"
                className="min-w-0 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-blue-700 dark:focus:ring-blue-950"
              />
              <input
                type="text"
                inputMode="numeric"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Number"
                className="min-w-0 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-blue-700 dark:focus:ring-blue-950"
              />
              <button
                type="submit"
                disabled={isImporting}
                className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                {isImporting ? "Importing..." : "Import law"}
              </button>
            </form>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Choose the act type, year, and number. If automatic import fails, LegalViz opens the corresponding EUR-Lex search page.
            </p>
            {importError && (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {importError}
              </p>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mt-8 w-full"
        >
          {!instructionsDismissed && !isExtensionReady && (
            <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
              Option 1 · Choose a popular EU law
            </h2>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {allLaws.map((law, idx) => (
              <motion.div
                key={law.key || law.value}
                whileHover={{ y: -2, scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => {
                  handleLawClick(law.key || law.value, law.isCustom);
                  if (law.isCustom) {
                    navigate(`/extension?extension=true&key=${law.key}`);
                  } else {
                    navigate(`/law/${law.key}`);
                  }
                }}

                className="group relative flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-gray-300 hover:shadow-md cursor-pointer dark:bg-gray-900 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:shadow-gray-900/50"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleLawClick(law.key || law.value, law.isCustom);
                    if (law.isCustom) {
                      navigate(`/extension?extension=true&key=${law.key}`);
                    } else {
                      navigate(`/law/${law.key}`);
                    }
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
                      <span>Last opened: {formatDate(law.timestamp)}</span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDelete(e, law.key || law.value, law.isCustom)}
                    className="absolute top-4 right-4 p-1.5 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 transition-all"
                    title={law.isCustom ? "Delete from local storage" : "Hide this law"}
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {
          !instructionsDismissed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mt-10 w-full"
            >
              {!isExtensionReady && (
                <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                  Option 2 · Visualise other EU laws
                </h2>
              )}
              <div className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${!isExtensionReady ? "mt-4" : ""} dark:bg-gray-900 dark:border-gray-800`}>
                <div className="flex w-full items-center justify-between px-6 py-4 text-left">
                  <button
                    type="button"
                    onClick={() => setShowExtensionInfo((prev) => !prev)}
                    className="flex flex-1 items-center justify-between mr-4"
                  >
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      Visualise other EU laws in 4 simple steps
                    </p>
                    <motion.span
                      animate={{ rotate: showExtensionInfo ? 90 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-xl text-gray-600 shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400"
                    >
                      ❯
                    </motion.span>
                  </button>

                  <button
                    onClick={dismissInstructions}
                    className="text-xs text-gray-400 hover:text-red-500 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    title="Dismiss these instructions permanently"
                  >
                    Dismiss
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {showExtensionInfo && (
                    <motion.div
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
                          Want to visualise a different EU law? Install our browser extension to open <strong>any recent EU law</strong> from EUR-Lex in this visualiser.
                        </p>

                        <div>
                          <p className="mb-3 font-medium text-gray-700 dark:text-gray-300">Install the extension:</p>
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
                          <p className="font-medium text-gray-900 dark:text-white">How it works:</p>
                          <ol className="mt-2 space-y-1.5 text-gray-700 dark:text-gray-300">
                            <li className="flex gap-2">
                              <span className="font-semibold text-gray-500">1.</span>
                              <span>Install the extension for your browser (see links above)</span>
                            </li>
                            <li className="flex gap-2">
                              <span className="font-semibold text-gray-500">2.</span>
                              <span>
                                Visit a EU law page on EUR-Lex{" "}
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
                              <span>Open the law in the <strong>English</strong> language using the language selector on EUR-Lex</span>
                            </li>
                            <li className="mt-2">
                              <img
                                src={`${import.meta.env.BASE_URL}language-selector.png`}
                                alt="EUR-Lex language selector showing available languages"
                                className="w-full rounded-lg border border-gray-200 shadow-sm"
                              />
                            </li>
                            <li className="flex gap-2">
                              <span className="font-semibold text-gray-500">4.</span>
                              <span>The extension automatically opens the law in this visualiser</span>
                            </li>
                          </ol>
                        </div>

                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )
        }

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mt-8 flex flex-col items-center gap-2 text-xs text-gray-500"
        >
          <p>
            Built by{" "}
            <a
              href="https://kollnig.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-700 hover:text-gray-900 underline"
            >
              Konrad Kollnig
            </a>{" "}
            at the{" "}
            <a
              href="https://www.maastrichtuniversity.nl/law-tech-lab"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-700 hover:text-gray-900 underline"
            >
              Law &amp; Tech Lab
            </a>
            , Maastricht University.
          </p>
          <a
            href="https://github.com/maastrichtlawtech/eur-lex-visualiser"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-gray-600 transition hover:text-gray-900 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <Github className="h-4 w-4" />
            <span>Source code and support on GitHub</span>
          </a>
        </motion.div>
      </div >
    </div >
  );
}
