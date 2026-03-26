import { motion as Motion } from "framer-motion";
import { Clock, Trash } from "lucide-react";

function formatOfficialReference(law) {
  const reference = law?.officialReference;
  if (reference?.actType && reference?.year && reference?.number) {
    const actTypeLabel = reference.actType.charAt(0).toUpperCase() + reference.actType.slice(1);
    return `${actTypeLabel} (EU) ${reference.year}/${reference.number}`;
  }

  const parts = String(law?.label || "").split(" — ").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(" — ") : "";
}

function getCardTitle(law) {
  const parts = String(law?.label || "").split(" — ").map((part) => part.trim()).filter(Boolean);
  return parts[0] || law?.label || "";
}

function LawLibraryCard({ law, onOpen, onDelete, formatDate, t }) {
  const title = getCardTitle(law);
  const officialReference = formatOfficialReference(law);
  const metaLine = [officialReference, law?.celex ? `CELEX ${law.celex}` : null].filter(Boolean).join(" · ");

  return (
    <Motion.div
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={() => onOpen(law)}
      className="group relative flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-gray-300 hover:shadow-md cursor-pointer dark:bg-gray-900 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:shadow-gray-900/50"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(law);
        }
      }}
      role="button"
    >
      <div className="flex items-start justify-between gap-2 w-full">
        <div className="flex-1 min-w-0">
          <div className="truncate pr-8 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </div>
          <div className="mt-1 truncate pr-8 text-[11px] text-gray-500 dark:text-gray-400">
            {metaLine}
          </div>
          <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-400">
            <Clock className="h-3 w-3" />
            <span>{t("common.lastOpened", { date: formatDate(law.timestamp) })}</span>
          </div>
        </div>

        <button
          onClick={(event) => onDelete(event, law.celex)}
          className="absolute top-4 right-4 p-1.5 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 transition-all"
          title={t("common.hideLaw")}
        >
          <Trash className="h-4 w-4" />
        </button>
      </div>
    </Motion.div>
  );
}

export function LandingLibrary({ laws, onOpenLaw, onDeleteLaw, formatDate, t }) {
  return (
    <>
      <Motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-8 w-full"
      >
        <div>
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
            {t("landing.recentTitle")}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("landing.recentDescription")}
          </p>
        </div>
      </Motion.div>

      <Motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mt-8 w-full"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {laws.length > 0 ? laws.map((law) => (
            <LawLibraryCard
              key={law.id}
              law={law}
              onOpen={onOpenLaw}
              onDelete={onDeleteLaw}
              formatDate={formatDate}
              t={t}
            />
          )) : (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 sm:col-span-2">
              {t("landing.recentEmpty")}
            </div>
          )}
        </div>
      </Motion.div>
    </>
  );
}
