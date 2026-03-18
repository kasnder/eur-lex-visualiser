import { useState, useRef, useEffect } from "react";
import { Globe } from "lucide-react";
import { EU_LANGUAGES } from "../utils/formexApi.js";

/**
 * Dropdown language selector for Formex laws.
 * Shows only when the current law supports Formex API (has celex).
 */
export function LanguageSelector({ currentLang, onChangeLang, useFormex, onToggleFormex, hasCelex }) {
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

  const langEntries = Object.entries(EU_LANGUAGES).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg transition-colors ${
          useFormex
            ? "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800"
            : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        }`}
        title={useFormex ? `Formex API (${currentLang})` : "Use Formex API"}
      >
        <Globe size={16} />
        {useFormex && <span className="font-medium">{currentLang}</span>}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10 z-50 animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
          {/* Formex toggle */}
          <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useFormex}
                onChange={(e) => {
                  onToggleFormex(e.target.checked);
                  if (!e.target.checked) setIsOpen(false);
                }}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Use Formex API</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Load from api.legalviz.eu</div>
              </div>
            </label>
          </div>

          {/* Language list */}
          {useFormex && (
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
                  <span className="font-mono text-xs text-gray-400 mr-2 dark:text-gray-500">{code}</span>
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
