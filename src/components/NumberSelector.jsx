import React, { useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";

export function NumberSelector({ label, total, onSelect }) {
  const { t } = useI18n();
  const [val, setVal] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 1 && num <= total) {
      onSelect(num);
      setVal("");
      setError(false);
    } else {
      setError(true);
    }
  };

  return (
    <div className="flex-1 min-w-[140px]">
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative flex items-center">
          <input
            type="number"
            min="1"
            max={total}
            value={val}
            onChange={(e) => {
              setVal(e.target.value);
              setError(false);
            }}
            className={`block w-full rounded-lg border px-3 py-2 text-sm outline-none transition pr-14 bg-gray-50 dark:bg-gray-800 dark:text-white ${error
                ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500 bg-red-50 dark:border-red-700 dark:bg-red-900/20"
                : "border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:bg-white dark:border-gray-700 dark:focus:bg-gray-900"
              }`}
            placeholder={`${label} (1-${total})`}
          />
          <button
            type="submit"
            disabled={!val}
            className="absolute right-1.5 top-1.5 bottom-1.5 px-3 bg-white hover:bg-gray-100 text-gray-600 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200 shadow-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            {t("common.go")}
          </button>
        </div>
        {error && <p className="absolute top-full left-0 mt-1 text-[10px] text-red-600 dark:text-red-400">{t("numberSelector.invalidRange")}</p>}
      </form>
    </div>
  );
}
