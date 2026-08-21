import { useEffect, useMemo, useState } from "react";

import { fetchAmendments, fetchConsolidatedVersions } from "../utils/formexApi.js";
import { selectConsolidatedVersions, summarizeAmendments } from "../utils/consolidatedVersions.js";

/**
 * Whether the act being read is still the current text, and where to find the
 * current one if it isn't.
 *
 * Both requests are best-effort: a Cellar outage must not put a "this may be
 * outdated" warning on a law we know nothing about, so `isOutdated` stays
 * false until the amendment history says otherwise. But a failed
 * `/consolidated` fetch is kept distinct from a genuine empty result — the
 * consolidated-version query is the slower of the two, so it is the one most
 * likely to time out, and reporting "no consolidated version exists" when we
 * simply don't know would be a falsehood. `consolidatedStatusUnknown` carries
 * that distinction to the caller instead of silently collapsing to `[]`.
 * Both endpoints are already IndexedDB-cached and de-duplicated in flight, so
 * sharing them with the metadata panel costs nothing.
 */
/**
 * Corrigenda are excluded from the amendment count on purpose (they correct
 * the published text rather than amend the law), but they are not nothing:
 * EUR-Lex applies them to the consolidated text and not to the act as
 * published, so a corrigendum-only act genuinely reads differently in the two.
 * The GDPR is the case in point — nine of its articles differ, including
 * Article 37(1)(c), where the corrigendum turned "and" into "or" and with it
 * the test for when a DPO must be appointed. Counting them lets the notice
 * say so.
 */
function countCorrigenda(amendments) {
  if (!Array.isArray(amendments)) return 0;
  return amendments.filter((entry) => entry && entry.type === "corrigendum").length;
}

export function useConsolidationStatus(celex) {
  const [amendments, setAmendments] = useState(null);
  const [amendmentsUnknown, setAmendmentsUnknown] = useState(false);
  const [amendmentsTruncated, setAmendmentsTruncated] = useState(false);
  const [versions, setVersions] = useState(null);
  const [consolidatedStatusUnknown, setConsolidatedStatusUnknown] = useState(false);

  useEffect(() => {
    setAmendments(null);
    setAmendmentsUnknown(false);
    setAmendmentsTruncated(false);
    setVersions(null);
    setConsolidatedStatusUnknown(false);
    if (!celex) return undefined;

    let cancelled = false;

    fetchAmendments(celex)
      .then((result) => {
        if (cancelled) return;
        setAmendments(result.amendments || []);
        setAmendmentsTruncated(Boolean(result.truncated));
      })
      .catch(() => {
        if (cancelled) return;
        // `[]` keeps `isOutdated` false so a Cellar outage cannot put a "this
        // may be outdated" warning on a law we know nothing about — but the
        // flag is what stops the *opposite* claim, that the law has never
        // been amended, from being made on the same non-evidence.
        setAmendments([]);
        setAmendmentsUnknown(true);
      });

    fetchConsolidatedVersions(celex)
      .then((result) => { if (!cancelled) setVersions(result.versions || []); })
      .catch(() => {
        if (cancelled) return;
        // Unlike the amendments failure above, this must not be treated as
        // "no consolidated version" — render `[]` for `selectConsolidatedVersions`
        // to work with, but flag it so the caller can tell the two apart.
        setVersions([]);
        setConsolidatedStatusUnknown(true);
      });

    return () => { cancelled = true; };
  }, [celex]);

  return useMemo(() => {
    const { count, latestDate } = summarizeAmendments(amendments);
    const { current, upcoming } = selectConsolidatedVersions(versions);

    return {
      isOutdated: count > 0,
      amendmentCount: count,
      amendmentCountExact: !amendmentsTruncated,
      latestAmendmentDate: latestDate,
      consolidated: current,
      hasUpcomingConsolidation: upcoming.length > 0,
      consolidatedStatusUnknown,
      // Still in flight. Distinct from `consolidatedStatusUnknown` (the fetch
      // failed) and from a genuine empty result: `versions` starts null, and
      // without this the caller cannot tell "not loaded yet" from "none
      // exists" and flashes "EUR-Lex has not published a consolidated
      // version" on first paint for acts that plainly have one.
      consolidatedStatusPending: versions === null,
      // The same two distinctions for the amendment history. Only when it
      // has actually answered can a caller say "this law has not been
      // amended" rather than merely declining to warn.
      amendmentStatusUnknown: amendmentsUnknown,
      amendmentStatusPending: amendments === null,
      corrigendumCount: countCorrigenda(amendments),
    };
  }, [amendments, amendmentsUnknown, amendmentsTruncated, versions, consolidatedStatusUnknown]);
}
