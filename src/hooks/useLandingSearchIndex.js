import { useCallback, useEffect, useRef, useState } from "react";
import { parseFormexToCombined } from "../utils/parsers.js";
import { getCachedFormex } from "../utils/formexApi.js";

export function useLandingSearchIndex({ formexLang, laws, libraryVersion }) {
  const [allLawsData, setAllLawsData] = useState({ articles: [], recitals: [], annexes: [] });
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [hasSearchInitialized, setHasSearchInitialized] = useState(false);
  const [searchableLawCount, setSearchableLawCount] = useState(0);
  const searchLoadInFlightRef = useRef(false);
  const searchLoadPromiseRef = useRef(null);

  useEffect(() => {
    setAllLawsData({ articles: [], recitals: [], annexes: [] });
    setHasSearchInitialized(false);
    setSearchableLawCount(0);
  }, [formexLang, libraryVersion]);

  const handleSearchOpen = useCallback(async () => {
    if (searchLoadInFlightRef.current && searchLoadPromiseRef.current) {
      return searchLoadPromiseRef.current;
    }

    if (hasSearchInitialized && !searchLoadInFlightRef.current) {
      return allLawsData;
    }

    searchLoadPromiseRef.current = (async () => {
      searchLoadInFlightRef.current = true;
      setIsSearchLoading(true);
      try {
        const combined = { articles: [], recitals: [], annexes: [] };

        const standardPromises = laws.map(async (law) => {
          try {
            if (!law.celex) return null;

            const text = await getCachedFormex(law.celex, formexLang);
            if (!text) return null;

            const parsed = parseFormexToCombined(text);
            const metadata = {
              routeKind: law.kind === "imported" ? "imported" : "bundled",
              law_key: law.key || null,
              law_slug: law.slug || null,
              celex: law.celex,
              raw: law.raw || null,
              langCode: parsed.langCode || formexLang,
            };

            parsed.articles?.forEach((entry) => {
              entry.law_key = law.id;
              entry.law_label = law.label;
              Object.assign(entry, metadata);
            });
            parsed.recitals?.forEach((entry) => {
              entry.law_key = law.id;
              entry.law_label = law.label;
              Object.assign(entry, metadata);
            });
            parsed.annexes?.forEach((entry) => {
              entry.law_key = law.id;
              entry.law_label = law.label;
              Object.assign(entry, metadata);
            });

            return parsed;
          } catch (error) {
            console.error(`Failed to load law ${law.key} for search index`, error);
            return null;
          }
        });

        const standardResults = await Promise.allSettled(standardPromises);

        standardResults.forEach((result) => {
          if (result.status === "fulfilled" && result.value) {
            combined.articles.push(...(result.value.articles || []));
            combined.recitals.push(...(result.value.recitals || []));
            combined.annexes.push(...(result.value.annexes || []));
          }
        });

        setAllLawsData(combined);
        const searchableIds = new Set(combined.articles.map((entry) => entry.celex).filter(Boolean));
        combined.recitals.forEach((entry) => {
          if (entry.celex) searchableIds.add(entry.celex);
        });
        combined.annexes.forEach((entry) => {
          if (entry.celex) searchableIds.add(entry.celex);
        });
        setSearchableLawCount(searchableIds.size);
        return combined;
      } catch (error) {
        console.error("Error loading search data", error);
        return { articles: [], recitals: [], annexes: [] };
      } finally {
        searchLoadInFlightRef.current = false;
        searchLoadPromiseRef.current = null;
        setHasSearchInitialized(true);
        setIsSearchLoading(false);
      }
    })();

    return searchLoadPromiseRef.current;
  }, [allLawsData, formexLang, hasSearchInitialized, laws]);

  const resetSearchIndex = useCallback(() => {
    setAllLawsData({ articles: [], recitals: [], annexes: [] });
    setHasSearchInitialized(false);
    setSearchableLawCount(0);
    searchLoadPromiseRef.current = null;
  }, []);

  return {
    allLawsData,
    handleSearchOpen,
    hasSearchInitialized,
    isSearchLoading,
    resetSearchIndex,
    searchableLawCount,
  };
}
