import React from "react";

/**
 * Displays cross-references for the currently selected article.
 *
 * Shows which other articles are referenced by the current article,
 * and which articles reference the current article (back-references).
 */
export function CrossReferences({ articleNumber, crossReferences, articles, onSelectArticle }) {
  if (!crossReferences || !articleNumber) return null;

  // Forward refs: articles referenced BY this article
  const forwardRefs = (crossReferences[articleNumber] || [])
    .filter(r => r.type === "article");

  // Back refs: articles that reference THIS article
  const backRefs = [];
  for (const [sourceArt, refs] of Object.entries(crossReferences)) {
    // Only article-level entries (not recital_*)
    if (sourceArt.startsWith("recital_")) continue;
    if (sourceArt === articleNumber) continue;
    if (refs.some(r => r.type === "article" && r.target === articleNumber)) {
      backRefs.push(sourceArt);
    }
  }

  if (forwardRefs.length === 0 && backRefs.length === 0) return null;

  // Build a lookup for article titles
  const titleMap = new Map();
  if (articles) {
    for (const a of articles) {
      titleMap.set(a.article_number, a.article_title || "");
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 text-amber-900 mb-4 px-6 md:px-12 dark:text-amber-300">
        <span className="font-semibold text-xl">Cross-References</span>
        <span className="bg-amber-100 text-amber-800 text-sm px-2.5 py-0.5 rounded-full font-medium dark:bg-amber-900/40 dark:text-amber-200">
          {forwardRefs.length + backRefs.length}
        </span>
      </div>

      <div className="space-y-6 px-6 md:px-12">
        {forwardRefs.length > 0 && (
          <div>
            <p className="text-sm text-gray-500 mb-3 dark:text-gray-400">
              This article references:
            </p>
            <div className="flex flex-wrap gap-2">
              {forwardRefs.map((ref, i) => {
                const title = titleMap.get(ref.target);
                return (
                  <button
                    key={`fwd-${i}`}
                    className="group inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm transition hover:border-amber-300 hover:shadow-sm cursor-pointer dark:bg-gray-800 dark:border-gray-700 dark:hover:border-amber-500"
                    onClick={() => onSelectArticle(ref.target)}
                    title={title ? `Article ${ref.target} — ${title}` : `Article ${ref.target}`}
                  >
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      Art. {ref.target}
                    </span>
                    {ref.paragraph && (
                      <span className="text-gray-500 dark:text-gray-400">
                        ({ref.paragraph})
                      </span>
                    )}
                    {title && (
                      <span className="text-xs text-gray-400 max-w-[120px] truncate dark:text-gray-500">
                        {title}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {backRefs.length > 0 && (
          <div>
            <p className="text-sm text-gray-500 mb-3 dark:text-gray-400">
              Referenced by:
            </p>
            <div className="flex flex-wrap gap-2">
              {backRefs.map((artNum) => {
                const title = titleMap.get(artNum);
                return (
                  <button
                    key={`back-${artNum}`}
                    className="group inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm transition hover:border-amber-300 hover:shadow-sm cursor-pointer dark:bg-gray-800 dark:border-gray-700 dark:hover:border-amber-500"
                    onClick={() => onSelectArticle(artNum)}
                    title={title ? `Article ${artNum} — ${title}` : `Article ${artNum}`}
                  >
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      Art. {artNum}
                    </span>
                    {title && (
                      <span className="text-xs text-gray-400 max-w-[120px] truncate dark:text-gray-500">
                        {title}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
