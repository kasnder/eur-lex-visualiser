const fs = require("fs");
const path = require("path");

const { enrichSearchRecord, scoreLaw } = require("./search-ranking");

const DEFAULT_SEARCH_CACHE_PATH = process.env.SEARCH_CACHE_PATH ||
  path.join(__dirname, "data", "search-cache.json");

class SearchIndex {
  constructor(cachePath = DEFAULT_SEARCH_CACHE_PATH) {
    this.cachePath = cachePath;
    this.payload = null;
    this.records = [];
    this.loadedAt = null;
    this.loadError = null;
  }

  loadFromDisk() {
    try {
      if (!fs.existsSync(this.cachePath)) {
        this.payload = null;
        this.records = [];
        this.loadedAt = null;
        this.loadError = `Search cache not found at ${this.cachePath}`;
        return false;
      }

      const raw = fs.readFileSync(this.cachePath, "utf8");
      const parsed = JSON.parse(raw);
      this.payload = parsed;
      this.records = Array.isArray(parsed.records)
        ? parsed.records.map((record) => enrichSearchRecord(record)).filter((record) => record.isPrimaryAct)
        : [];
      this.loadedAt = new Date().toISOString();
      this.loadError = null;
      return true;
    } catch (error) {
      this.payload = null;
      this.records = [];
      this.loadedAt = null;
      this.loadError = error.message;
      return false;
    }
  }

  isReady() {
    return this.records.length > 0;
  }

  getStatus() {
    return {
      ready: this.isReady(),
      cachePath: this.cachePath,
      loadedAt: this.loadedAt,
      count: this.records.length,
      error: this.loadError
    };
  }

  searchLaws(query, options = {}) {
    if (!this.isReady()) {
      const error = new Error(this.loadError || "Law search cache is not loaded");
      error.code = "search_cache_unavailable";
      throw error;
    }

    const limit = Math.max(1, Math.min(Number.parseInt(options.limit || "10", 10) || 10, 50));
    const disableRewrites = Boolean(options.disableRewrites);

    return this.records
      .map((law) => {
        const { score, matchReason } = scoreLaw(law, query, { disableRewrites });
        return { law, score, matchReason };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(b.law.date || "").localeCompare(String(a.law.date || ""));
      })
      .slice(0, limit)
      .map((entry) => ({
        celex: entry.law.celex,
        title: entry.law.title,
        type: entry.law.type,
        date: entry.law.date || null,
        eli: entry.law.eli || null,
        fmxAvailable: Boolean(entry.law.fmxAvailable),
        matchReason: entry.matchReason
      }));
  }
}

module.exports = {
  DEFAULT_SEARCH_CACHE_PATH,
  SearchIndex
};
