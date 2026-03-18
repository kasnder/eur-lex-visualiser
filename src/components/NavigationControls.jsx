import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";

export function NavigationControls({ selected, lists, onPrevNext, className = "" }) {
  const { t } = useI18n();
  const { articles, recitals, annexes } = lists;

  const getListAndIndex = () => {
    if (selected.kind === "article") {
      const idx = articles?.findIndex((a) => a.article_number === selected.id) ?? -1;
      return { kind: "article", index: idx, list: articles, label: t("common.article") };
    }
    if (selected.kind === "recital") {
      const idx = recitals?.findIndex((r) => r.recital_number === selected.id) ?? -1;
      return { kind: "recital", index: idx, list: recitals, label: t("common.recital") };
    }
    if (selected.kind === "annex") {
      const idx = annexes?.findIndex((x) => x.annex_id === selected.id) ?? -1;
      return { kind: "annex", index: idx, list: annexes, label: t("common.annex") };
    }
    return { kind: null, index: -1, list: [], label: "" };
  };

  const { kind, index, list, label } = getListAndIndex();

  if (!kind || !list || list.length === 0) return null;

  return (
    <div className={`flex items-center justify-between gap-1 rounded-lg bg-gray-50 p-1 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 ${className}`}>
      <Button
        variant="ghost"
        className="h-8 w-8 p-0 text-gray-500 hover:text-gray-900 flex-shrink-0 dark:text-gray-400 dark:hover:text-gray-200"
        disabled={index <= 0}
        onClick={() => onPrevNext(kind, index - 1)}
        title={t("navigation.previous", { label })}
      >
        <ChevronLeft size={18} />
      </Button>

      <span className="flex-1 px-2 text-center text-sm font-medium text-gray-600 truncate min-w-0 dark:text-gray-300">
        <span className="text-gray-900 dark:text-gray-100">{label} {index + 1}</span>
        <span className="mx-1 text-gray-400 dark:text-gray-500">/</span>
        {list.length}
      </span>

      <Button
        variant="ghost"
        className="h-8 w-8 p-0 text-gray-500 hover:text-gray-900 flex-shrink-0 dark:text-gray-400 dark:hover:text-gray-200"
        disabled={index === -1 || index >= list.length - 1}
        onClick={() => onPrevNext(kind, index + 1)}
        title={t("navigation.next", { label })}
      >
        <ChevronRight size={18} />
      </Button>
    </div>
  );
}
