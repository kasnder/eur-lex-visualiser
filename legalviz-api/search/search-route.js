function createSearchHandler(searchIndex) {
  return function searchHandler(req, res) {
    try {
      const query = String(req.query.q || "").trim();
      if (!query) {
        return res.status(400).json({ error: 'Query parameter "q" required' });
      }

      const results = searchIndex.searchLaws(query, {
        limit: req.query.limit,
        disableRewrites: req.query.noRewrite === "1"
      });

      res.json({
        query,
        count: results.length,
        results
      });
    } catch (error) {
      if (error.code === "search_cache_unavailable") {
        return res.status(503).json({
          error: "Law search cache is not available",
          code: error.code,
          details: searchIndex.getStatus()
        });
      }

      console.error("[Search] Failed to search laws:", error.message);
      res.status(500).json({ error: "Law search failed" });
    }
  };
}

module.exports = {
  createSearchHandler
};
