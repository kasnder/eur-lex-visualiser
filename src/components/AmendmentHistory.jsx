import React from "react";
import { buildEurlexCelexUrl } from "../utils/url.js";
import { Accordion } from "./Accordion.jsx";
import { useI18n } from "../i18n/useI18n.js";

function formatDate(isoDate) {
  if (!isoDate) return null;
  try {
    return new Date(isoDate).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}

const TYPE_BADGE = {
  corrigendum: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  amendment:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

/**
 * Sidebar panel showing acts that have amended the currently viewed law,
 * fetched live from the Cellar SPARQL endpoint.
 *
 * All entries link out to EUR-Lex — corrigenda and amending acts cannot be
 * loaded in the reader because they use a different FMX schema (<CONS.ACT>).
 *
 * Props:
 *  - amendments: array of { celex: string, date: string|null, type: 'amendment'|'corrigendum' }
 *  - loading: boolean
 *  - currentLang: 2-letter language code used for EUR-Lex links
 */
export function AmendmentHistory({ amendments, loading, currentLang = "EN" }) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="pt-4">
        <Accordion title={t("amendmentHistory.title")} defaultOpen={false}>
          <div className="py-2 text-sm text-gray-400 dark:text-gray-500 animate-pulse">
            {t("amendmentHistory.loading")}
          </div>
        </Accordion>
      </div>
    );
  }

  if (!amendments || amendments.length === 0) return null;

  return (
    <div className="pt-4">
      <Accordion
        title={`${t("amendmentHistory.title")} (${amendments.length})`}
        defaultOpen={false}
      >
        <ul className="space-y-2">
          {amendments.map((a) => {
            const eurlexUrl = buildEurlexCelexUrl(a.celex, currentLang);
            const dateLabel = formatDate(a.date);
            const badgeCls = TYPE_BADGE[a.type] || TYPE_BADGE.amendment;
            return (
              <li key={a.celex}>
                <a
                  href={eurlexUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs transition hover:border-gray-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badgeCls}`}>
                      {a.type === "corrigendum" ? t("amendmentHistory.corrigendum") : t("amendmentHistory.amendment")}
                    </span>
                    {dateLabel && (
                      <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
                        {dateLabel}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-gray-300 group-hover:text-gray-400 dark:text-gray-600 dark:group-hover:text-gray-500">↗</span>
                  </div>
                  <span className="font-medium text-gray-700 group-hover:text-blue-700 dark:text-gray-300 dark:group-hover:text-blue-400 truncate">
                    {a.celex}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </Accordion>
    </div>
  );
}
