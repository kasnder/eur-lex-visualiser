import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Search, X, ExternalLink, Printer, Loader2, PanelLeftClose, PanelLeftOpen, Minus, Plus, MoreVertical } from "lucide-react";
import { Button } from "./Button.jsx";
import { ThemeToggle } from "./ThemeToggle.jsx";
import { LanguageSelector } from "./LanguageSelector.jsx";
import { searchContent, searchIndex as searchWithIndex, buildSearchIndex } from "../utils/nlp.js";

function SearchBox({ lists, onNavigate, onSearchOpen, isSearchLoading }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [searchIndex, setSearchIndex] = useState(null);
  const [isBuilding, setIsBuilding] = useState(false);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);

  // Trigger search data loading on open
  useEffect(() => {
    if (isOpen) {
      onSearchOpen?.();
    }
  }, [isOpen, onSearchOpen]);

  // Reset index when law changes
  useEffect(() => {
    setSearchIndex(null);
    setQuery("");
    setResults([]);
  }, [lists]);

  // Build index on open if needed
  useEffect(() => {
    if (isOpen && !searchIndex && !isBuilding) {
      setIsBuilding(true);
      // Timeout to allow UI to render loading state
      setTimeout(() => {
        try {
          const idx = buildSearchIndex(lists);
          setSearchIndex(idx);
        } catch (e) {
          console.error("Failed to build search index", e);
        } finally {
          setIsBuilding(false);
        }
      }, 100);
    }
  }, [isOpen, searchIndex, isBuilding, lists]);

  // Close when pressing Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
      // Command/Ctrl + K to open
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Keyboard navigation within modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          handleSelect(results[selectedIndex]);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, results, selectedIndex]);

  // Auto-scroll to selected item
  useEffect(() => {
    if (selectedIndex >= 0 && resultsRef.current) {
      const selectedEl = resultsRef.current.children[selectedIndex];
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex]);

  const handleSearch = (e) => {
    const q = e.target.value;
    setQuery(q);

    if (isBuilding) return;

    if (q.length >= 2) {
      let res;
      if (searchIndex) {
        res = searchWithIndex(q, searchIndex);
      } else {
        // Fallback if index missing for some reason
        res = searchContent(q, lists);
      }
      setResults(res);
    } else {
      setResults([]);
    }
  };

  const handleSelect = (item) => {
    onNavigate(item);
    // setQuery(""); // Keep search term
    // setResults([]); // Keep results
    setIsOpen(false);
  };

  return (
    <>
      {/* Search Input Trigger */}
      <div className="relative lg:w-64 transition-all" ref={containerRef}>
        {/* Desktop Input (Large screens only) */}
        <div className="relative w-full hidden lg:block">
          <input
            ref={inputRef}
            type="text"
            readOnly
            onClick={() => setIsOpen(true)}
            placeholder="Search (Cmd+K)..."
            className="w-full cursor-pointer rounded-xl border border-gray-200 bg-gray-50 py-1.5 pl-9 pr-4 text-sm outline-none hover:bg-white hover:border-blue-300 focus:ring-0 transition-all text-gray-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700 dark:placeholder:text-gray-500"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={16} />
        </div>

        {/* Mobile/Tablet Icon Button (Small & Medium screens) */}
        <div className="lg:hidden">
          <button
            onClick={() => setIsOpen(true)}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800"
          >
            <Search size={20} />
          </button>
        </div>
      </div>

      {/* Spotlight Modal Overlay (Rendered in Portal to cover whole screen) */}
      {isOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/20 transition-all md:p-4 md:pt-[15vh]">
          <div
            className="w-full max-w-2xl flex flex-col h-full md:h-auto md:max-h-[70vh] bg-white shadow-2xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-100 overflow-hidden fixed inset-0 md:static md:inset-auto md:rounded-2xl dark:bg-gray-900 dark:ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with Auto-focused Input */}
            <div className="flex-none border-b border-gray-100 px-4 py-3 bg-white flex items-center gap-3 dark:bg-gray-900 dark:border-gray-800">
              <button
                onClick={() => setIsOpen(false)}
                className="md:hidden text-gray-500 hover:text-gray-900 p-1 -ml-1"
              >
                <ChevronLeft size={24} />
              </button>
              <Search size={20} className="text-gray-400 hidden md:block" />
              <div className="flex-1 relative">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={handleSearch}
                  placeholder={isBuilding || isSearchLoading ? "Initializing search..." : "Search..."}
                  disabled={isBuilding || isSearchLoading}
                  className="w-full text-lg text-gray-900 placeholder:text-gray-400 outline-none bg-transparent pr-8 disabled:opacity-50 dark:text-white dark:placeholder:text-gray-600"
                />
                {isBuilding || isSearchLoading ? (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2">
                    <Loader2 className="animate-spin text-blue-600" size={20} />
                  </div>
                ) : query && (
                  <button
                    onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                    title="Clear search"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="h-6 w-px bg-gray-200 mx-1 hidden md:block dark:bg-gray-700"></div>
              <button
                onClick={() => setIsOpen(false)}
                className="hidden md:block text-sm font-medium text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 scroll-smooth bg-gray-50/30 dark:bg-gray-950/50">
              {results.length > 0 ? (
                <div className="flex flex-col gap-2 p-2 w-full" ref={resultsRef}>
                  {results.map((item, idx) => (
                    <button
                      type="button"
                      key={`${item.type}-${item.id}-${idx}`}
                      onClick={() => handleSelect(item)}
                      className={`group flex flex-col gap-1 p-3 text-left rounded-xl transition-all w-full ${idx === selectedIndex
                        ? "bg-blue-50 ring-1 ring-blue-200 shadow-sm dark:bg-blue-900/30 dark:ring-blue-700"
                        : "hover:bg-blue-50/50 hover:ring-1 hover:ring-blue-200 bg-white md:bg-transparent dark:bg-gray-800 md:dark:bg-transparent dark:hover:ring-blue-800 dark:hover:bg-blue-900/20"
                        }`}
                    >
                      <div className="flex items-center gap-2.5 w-full min-w-0">
                        <span className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${item.type === 'article' ? 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800' :
                          item.type === 'recital' ? 'bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-800' :
                            'bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-900/40 dark:text-orange-200 dark:border-orange-800'
                          }`}>
                          {item.type}
                        </span>
                        <span className="font-semibold text-gray-900 text-base truncate flex-1 min-w-0 group-hover:text-blue-700">
                          {item.title}
                        </span>
                        {item.score > 100 && (
                          <span className="flex-shrink-0 text-[10px] bg-green-100 text-green-700 px-1.5 rounded-full font-medium">Best Match</span>
                        )}
                        {item.law_label && (
                          <span className="flex-shrink-0 text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium dark:bg-gray-800 dark:text-gray-400">
                            {item.law_label}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 line-clamp-2 pl-1 leading-relaxed">
                        <span className="opacity-70">...</span>
                        {item.preview}
                        <span className="opacity-70">...</span>
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  {query.length < 2 ? (
                    <>
                      <Search size={48} className="opacity-10 mb-4" />
                      <p className="text-sm">Type to start searching...</p>
                    </>
                  ) : (
                    <>
                      <Search size={48} className="opacity-20 mb-4" />
                      <p className="text-sm">No results found for "{query}"</p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="hidden md:flex flex-none border-t border-gray-100 px-4 py-2 bg-gray-50 text-[10px] text-gray-400 justify-between dark:bg-gray-900 dark:border-gray-800 dark:text-gray-500">
              <span>Select to navigate</span>
              <span>ESC to close</span>
            </div>
          </div>

          {/* Click backdrop to close */}
          <div className="absolute inset-0 -z-10" />
        </div>,
        document.body
      )}
    </>
  );
}

export function TopBar({
  lawKey,
  title,
  lists,
  isExtensionMode,
  eurlexUrl,
  onPrint,
  showPrint = true,
  onSearchOpen,
  isSearchLoading,
  onToggleSidebar,
  isSidebarOpen,
  onIncreaseFont,
  onDecreaseFont,
  fontSize,
  formexLang,
  onFormexLangChange,
  useFormex,
  onToggleFormex,
  hasCelex,
}) {
  const navigate = useNavigate();
  const { articles, recitals, annexes } = lists;

  const onNavigate = (item) => {
    const extensionParams = isExtensionMode && lawKey === 'extension'
      ? window.location.search
      : '';

    // Ensure ID is a string before encoding
    const safeId = encodeURIComponent(String(item.id));
    const targetLawKey = item.law_key || lawKey;

    if (isExtensionMode) {
      navigate(`/extension/${item.type}/${safeId}${extensionParams}`);
    } else {
      navigate(`/law/${targetLawKey}/${item.type}/${safeId}`);
    }
  };

  return (
    <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/95 backdrop-blur-sm supports-[backdrop-filter]:bg-white/80 dark:bg-gray-900/95 dark:supports-[backdrop-filter]:bg-gray-900/80 dark:border-gray-800">
      <div className="relative mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 md:px-6">
        {/* Left: Branding */}
        <div className="flex-shrink-0 flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center justify-center transition-opacity hover:opacity-80"
          >
            <img
              src={`${import.meta.env.BASE_URL}wizard.png`}
              alt="LegalViz Wizard"
              className="h-10 w-auto dark:invert dark:hue-rotate-180"
            />
          </button>
          <div className="hidden md:flex flex-col">
            <button
              onClick={() => navigate("/")}
              className="text-left text-lg font-bold tracking-tight text-gray-900 leading-none transition-opacity hover:opacity-80 dark:text-white"
            >
              LegalViz.EU
            </button>
            <span className="text-[10px] text-gray-500 leading-tight mt-0.5">
              By{" "}
              <a
                href="https://kollnig.net"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-700 hover:underline"
              >
                Konrad Kollnig
              </a>
              ,{" "}
              <a
                href="https://www.maastrichtuniversity.nl/law-tech-lab"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-700 hover:underline"
              >
                Law & Tech Lab Maastricht
              </a>
            </span>
          </div>
        </div>

        {/* Center: Title */}
        <div className="flex-1 min-w-0 flex items-center justify-center">
          {title && (
            <div className="flex items-center gap-2 min-w-0 max-w-full">
              <span
                className="line-clamp-2 text-sm font-medium text-gray-700 dark:text-gray-300 text-center"
                title={title}
              >
                {title}
              </span>

            </div>
          )}
        </div>

        {/* Right: Navigation Controls */}
        <div className="flex-shrink-0 flex items-center gap-2 md:gap-3">

          {/* Language Selector */}
          <LanguageSelector
            currentLang={formexLang}
            onChangeLang={onFormexLangChange}
            useFormex={useFormex}
            onToggleFormex={onToggleFormex}
            hasCelex={hasCelex}
          />

          {/* Tools Group (Unified Menu) */}
          <div className="relative flex items-center">
            <ToolsMenu
              onPrint={onPrint}
              showPrint={showPrint}
              onIncreaseFont={onIncreaseFont}
              onDecreaseFont={onDecreaseFont}
              fontSize={fontSize}
              eurlexUrl={eurlexUrl}
              onToggleSidebar={onToggleSidebar}
              isSidebarOpen={isSidebarOpen}
            />
          </div>

          <SearchBox lists={lists} onNavigate={onNavigate} onSearchOpen={onSearchOpen} isSearchLoading={isSearchLoading} />

        </div>
      </div>
    </header>
  );
}

function ToolsMenu({ onPrint, showPrint, onIncreaseFont, onDecreaseFont, fontSize, eurlexUrl, onToggleSidebar, isSidebarOpen }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close menu when actions are clicked
  const handleAction = (action) => {
    action();
    // setIsOpen(false); // Optional: close on action? Maybe not for zoom controls.
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 rounded-lg transition-colors ${isOpen ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'}`}
        title="More tools"
      >
        <MoreVertical size={20} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 p-2 bg-white rounded-xl shadow-xl ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10 flex flex-col gap-1 z-50 animate-in fade-in zoom-in-95 duration-100">

          {/* Sidebar Toggle (Desktop Only) */}
          {onToggleSidebar && (
            <button
              onClick={() => { onToggleSidebar(); setIsOpen(false); }}
              className="hidden md:flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
              <span>{isSidebarOpen ? "Hide sidebar" : "Show sidebar"}</span>
            </button>
          )}

          {/* Print */}
          {showPrint && (
            <button
              onClick={() => { onPrint(); setIsOpen(false); }}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <Printer size={18} />
              <span>Print / PDF</span>
            </button>
          )}

          {/* EUR-Lex Link */}
          {eurlexUrl && (
            <a
              href={eurlexUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <ExternalLink size={18} />
              <span>View on EUR-Lex</span>
            </a>
          )}

          {/* Theme */}
          <div className="px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700 dark:text-gray-200">Theme</span>
              <ThemeToggle />
            </div>
          </div>

          {/* Font Size */}
          {onIncreaseFont && (
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
              <div className="mb-1.5 text-xs text-gray-500 uppercase font-semibold dark:text-gray-400">Text Size</div>
              <div className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg p-1 dark:bg-gray-800">
                <button onClick={onDecreaseFont} className="p-1 hover:bg-white rounded-md shadow-sm transition-all dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
                  <Minus size={16} />
                </button>
                <span className="text-xs font-mono w-8 text-center text-gray-900 dark:text-gray-200">{fontSize}%</span>
                <button onClick={onIncreaseFont} className="p-1 hover:bg-white rounded-md shadow-sm transition-all dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
                  <Plus size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
