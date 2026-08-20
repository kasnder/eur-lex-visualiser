const { validateFulltextQuery } = require("./legal-cache-store");

function createFulltextSearchHandler(store, { validateCelex } = {}) {
  return function fulltextSearchHandler(req, res) {
    try {
      const query = String(req.query.q || "").trim();
      if (!query) {
        return res.status(400).json({
          error: 'Query parameter "q" required',
          code: "fulltext_query_required",
        });
      }
      const queryError = validateFulltextQuery(query);
      if (queryError) {
        return res.status(400).json({ error: queryError.message, code: queryError.code });
      }

      let celex = null;
      if (req.query.celex !== undefined && req.query.celex !== null && String(req.query.celex).trim()) {
        celex = String(req.query.celex).trim().toUpperCase();
        if (typeof validateCelex === "function" && !validateCelex(celex)) {
          return res.status(400).json({ error: "Invalid CELEX format", code: "invalid_celex" });
        }
      }

      const results = store.searchFulltextUnits(query, {
        limit: req.query.limit,
        celex,
      });
      return res.json({ query, celex, count: results.length, results });
    } catch (error) {
      if (error.code === "fulltext_index_unavailable") {
        return res.status(503).json({
          error: "Full-text index is not available",
          code: error.code,
          details: typeof store.getFulltextStatus === "function"
            ? store.getFulltextStatus()
            : undefined,
        });
      }
      if (error.code === "fulltext_query_required"
        || error.code === "fulltext_query_too_long"
        || error.code === "fulltext_query_empty"
        || error.code === "fulltext_query_too_short"
        || error.code === "fulltext_query_too_many_terms") {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      console.error("[FulltextSearch] Failed to search law text:", error.message);
      return res.status(500).json({ error: "Full-text search failed" });
    }
  };
}

module.exports = { createFulltextSearchHandler };
