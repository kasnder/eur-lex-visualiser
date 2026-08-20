function readRange(range) {
  if (Array.isArray(range)) {
    return { start: Number(range[0]), end: Number(range[1]) };
  }

  if (!range || typeof range !== "object") return null;
  return {
    start: Number(range.start ?? range.from),
    end: Number(range.end ?? range.to),
  };
}
/**
 * Render backend-provided snippet offsets. The offsets are relative to the
 * plain-text snippet, so highlighting remains correct for prefixes,
 * punctuation, and diacritic-normalized FTS matches.
 */
export function HighlightedFulltextSnippet({ text, highlightRanges = [], className = "" }) {
  const source = String(text || "");
  if (!source || !Array.isArray(highlightRanges) || highlightRanges.length === 0) {
    return <span className={className}>{source}</span>;
  }

  const ranges = highlightRanges
    .map(readRange)
    .filter((range) => (
      range
      && Number.isFinite(range.start)
      && Number.isFinite(range.end)
      && range.end > range.start
    ))
    .map((range) => ({
      start: Math.max(0, Math.min(source.length, Math.floor(range.start))),
      end: Math.max(0, Math.min(source.length, Math.floor(range.end))),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (ranges.length === 0) return <span className={className}>{source}</span>;

  const parts = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    // Overlapping ranges are merged by skipping the already-rendered prefix.
    const start = Math.max(cursor, range.start);
    if (start > cursor) parts.push(source.slice(cursor, start));
    const end = Math.max(start, range.end);
    if (end > start) {
      parts.push(
        <mark
          key={`fulltext-highlight-${index}`}
          className="rounded-sm bg-amber-100 px-0.5 text-inherit dark:bg-amber-800/60"
        >
          {source.slice(start, end)}
        </mark>,
      );
    }
    cursor = Math.max(cursor, end);
  });
  if (cursor < source.length) parts.push(source.slice(cursor));

  return <span className={className}>{parts}</span>;
}

function unitLabel(item, t) {
  const number = item.number == null || item.number === "" ? "" : ` ${item.number}`;
  const unitType = String(item.unitType || "").toLowerCase();
  if (unitType === "article") return t("search.fulltextArticle", { number: String(item.number ?? "") }) || `Art.${number}`;
  if (unitType === "recital") return t("search.fulltextRecital", { number: String(item.number ?? "") }) || `Recital${number}`;
  return item.unitType ? `${item.unitType}${number}` : t("search.fulltextUnit");
}

export function FulltextSearchResult({ item, t }) {
  const title = String(item.title || item.celex || "").trim();
  const heading = String(item.heading || "").trim();
  const celex = String(item.celex || "").trim();

  return (
    <>
      <div className="flex w-full min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-display text-[15px] font-bold text-eu-navy group-hover:text-eu-blue dark:text-white dark:group-hover:text-eu-blue-bright">
          {title}
        </span>
        <span className="flex-shrink-0 rounded-md border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
          {unitLabel(item, t)}
        </span>
      </div>
      {heading ? (
        <p className="truncate pl-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {heading}
        </p>
      ) : null}
      {item.snippet ? (
        <HighlightedFulltextSnippet
          text={item.snippet}
          highlightRanges={item.highlightRanges}
          className="pl-1 text-sm leading-relaxed text-gray-500 line-clamp-3 dark:text-gray-300"
        />
      ) : null}
      {celex ? (
        <p className="pl-1 font-mono text-[10.5px] text-gray-400 dark:text-gray-500">{celex}</p>
      ) : null}
    </>
  );
}
