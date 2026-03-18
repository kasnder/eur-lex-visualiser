import { useState, useRef, useEffect } from "react";
import { EU_LANGUAGES } from "../utils/formexApi.js";
import { getLanguageFlag } from "../utils/languageFlags.js";
import { useI18n } from "../i18n/useI18n.js";

/**
 * Dropdown language selector for Formex-backed laws.
 */
export function LanguageSelector({
  currentLang,
  onChangeLang,
  hasCelex,
  label = null,
  excludeLanguages = [],
  align = "right",
  showCode = true,
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  if (!hasCelex) return null;

  const excluded = new Set(excludeLanguages.map((code) => String(code || "").toUpperCase()));
  const langEntries = Object.entries(EU_LANGUAGES)
    .filter(([code]) => !excluded.has(code))
    .sort((a, b) => a[1].localeCompare(b[1]));
  const menuPositionClass = align === "left" ? "left-0" : "right-0";
  const currentLabel = EU_LANGUAGES[currentLang] || currentLang;

  return (
    <div className="relative" ref={menuRef}>
      <div className="flex flex-col items-start gap-1">
        {label ? (
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {label}
          </span>
        ) : null}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-sm text-blue-700 transition-colors dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
          title={t("languageSelector.formexTitle", { lang: currentLang })}
        >
          <span>{getLanguageFlag(currentLang)}</span>
          <span className="font-medium">{showCode ? currentLang : currentLabel}</span>
        </button>
      </div>

      {isOpen && (
        <div className={`absolute ${menuPositionClass} top-full mt-2 w-64 bg-white rounded-xl shadow-xl ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10 z-50 animate-in fade-in zoom-in-95 duration-100 overflow-hidden`}>
          <div className="max-h-64 overflow-y-auto p-1">
            {langEntries.map(([code, name]) => (
              <button
                key={code}
                onClick={() => {
                  onChangeLang(code);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  code === currentLang
                    ? "bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-300"
                    : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="mr-2">{getLanguageFlag(code)}</span>
                {showCode ? (
                  <span className="font-mono text-xs text-gray-400 mr-2 dark:text-gray-500">{code}</span>
                ) : null}
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
