import { parseOfficialReference } from "./officialReferences.js";
import { getBundledLaws, getCanonicalLawRoute, buildImportedLawCandidate, findBundledLawByCelex } from "./lawRouting.js";
import { buildEurlexCelexUrl } from "./url.js";
import { getAllLawMeta, listCachedCelexes, upsertLawMeta } from "./formexApi.js";

function normalizeOfficialReference(reference) {
  if (!reference) return null;

  const actType = String(reference.actType || "").trim().toLowerCase();
  const year = String(reference.year || "").trim();
  const number = String(reference.number || "").trim();

  if (!actType || !year || !number) return null;
  return { actType, year, number };
}

function sameOfficialReference(left, right) {
  const normalizedLeft = normalizeOfficialReference(left);
  const normalizedRight = normalizeOfficialReference(right);
  if (!normalizedLeft || !normalizedRight) return false;

  return (
    normalizedLeft.actType === normalizedRight.actType &&
    normalizedLeft.year === normalizedRight.year &&
    normalizedLeft.number === normalizedRight.number
  );
}

function dispatchLibraryUpdate() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("legalviz-library-updated"));
  } catch {
    // ignore
  }
}

function normalizeLawMetaEntry(entry) {
  if (!entry?.celex) return null;

  const parsedReference = entry.officialReference
    || parseOfficialReference(entry.raw || "")
    || parseOfficialReference(entry.label || "");
  const bundledLaw = findBundledLawByCelex(entry.celex);
  const routeCandidate = bundledLaw || buildImportedLawCandidate({
    ...entry,
    officialReference: parsedReference,
  });

  return {
    celex: entry.celex,
    label: entry.label || entry.raw || `CELEX ${entry.celex}`,
    raw: entry.raw || null,
    officialReference: routeCandidate?.officialReference || null,
    slug: routeCandidate?.slug || null,
    eurlex: entry.eurlex || null,
    addedAt: entry.addedAt || Date.now(),
  };
}

function inferOfficialReferenceFromCelex(celex) {
  const match = String(celex || "").match(/^3(\d{4})([RLD])(\d{4})$/);
  if (!match) return null;

  const actTypeMap = {
    R: "regulation",
    L: "directive",
    D: "decision",
  };

  const actType = actTypeMap[match[2]] || null;
  if (!actType) return null;

  return {
    actType,
    year: match[1],
    number: String(Number(match[3])),
  };
}

function getFallbackLabel(celex, officialReference) {
  if (officialReference?.actType && officialReference?.year && officialReference?.number) {
    const actTypeLabel = officialReference.actType.charAt(0).toUpperCase() + officialReference.actType.slice(1);
    return `${actTypeLabel} ${officialReference.year}/${officialReference.number}`;
  }
  return `CELEX ${celex}`;
}

export async function saveLawMeta(entry) {
  if (!entry?.celex) return null;

  const normalized = normalizeLawMetaEntry(entry);
  if (!normalized) return null;

  const saved = await upsertLawMeta(normalized.celex, {
    label: normalized.label,
    raw: normalized.raw,
    officialReference: normalized.officialReference,
    eurlex: normalized.eurlex || buildEurlexCelexUrl(normalized.celex),
    addedAt: normalized.addedAt || Date.now(),
    hidden: false,
  });
  dispatchLibraryUpdate();
  return saved;
}

export async function markLawOpened(celex) {
  if (!celex) return null;
  const saved = await upsertLawMeta(celex, {
    lastOpened: Date.now(),
    hidden: false,
  });
  dispatchLibraryUpdate();
  return saved;
}

export async function setLawHidden(celex, hidden) {
  if (!celex) return null;
  const saved = await upsertLawMeta(celex, { hidden: Boolean(hidden) });
  dispatchLibraryUpdate();
  return saved;
}

export async function getLibraryLaws() {
  const metaEntries = await getAllLawMeta();
  const metaByCelex = new Map(metaEntries.filter((entry) => entry?.celex).map((entry) => [entry.celex, entry]));
  const bundled = getBundledLaws().map((law) => {
    const meta = law.celex ? metaByCelex.get(law.celex) : null;
    return {
      ...law,
      id: law.key,
      kind: "bundled",
      route: getCanonicalLawRoute(law),
      timestamp: meta?.lastOpened || null,
      addedAt: meta?.addedAt || 0,
    };
  });

  const bundledByCelex = new Map(bundled.filter((law) => law.celex).map((law) => [law.celex, law]));
  const cachedCelexes = await listCachedCelexes();

  const cached = cachedCelexes.map((celex) => {
    const bundledLaw = bundledByCelex.get(celex);
    if (bundledLaw) {
      const meta = metaByCelex.get(celex);
      return {
        ...bundledLaw,
        timestamp: meta?.lastOpened || bundledLaw.timestamp || null,
        addedAt: meta?.addedAt || bundledLaw.addedAt || 0,
      };
    }

    const meta = metaByCelex.get(celex);
    const officialReference = meta?.officialReference || inferOfficialReferenceFromCelex(celex);
    const candidate = buildImportedLawCandidate({
      celex,
      officialReference,
    });

    return {
      ...candidate,
      id: `import:${celex}`,
      kind: "imported",
      celex,
      label: meta?.label || meta?.raw || getFallbackLabel(celex, officialReference),
      raw: meta?.raw || null,
      officialReference: candidate?.officialReference || officialReference || null,
      slug: candidate?.slug || null,
      eurlex: meta?.eurlex || buildEurlexCelexUrl(celex),
      addedAt: meta?.addedAt || 0,
      timestamp: meta?.lastOpened || null,
      route: getCanonicalLawRoute(candidate),
    };
  });

  return [...bundled, ...cached.filter((law) => !bundledByCelex.has(law.celex))]
    .filter((law) => {
      const meta = law.celex ? metaByCelex.get(law.celex) : null;
      if (meta?.hidden) return false;
      if (law.kind === "bundled" && law.shownInUi === false && !law.timestamp) return false;
      return true;
    })
    .sort((a, b) => {
      const timeDiff = (b.timestamp || 0) - (a.timestamp || 0);
      if (timeDiff !== 0) return timeDiff;
      return (b.addedAt || 0) - (a.addedAt || 0);
    });
}

export async function findStoredLawMetaByOfficialReference(reference) {
  const target = normalizeOfficialReference(reference);
  if (!target) return null;

  const metaEntries = await getAllLawMeta();
  return metaEntries.find((entry) => {
    if (!entry?.celex) return false;
    const entryReference = entry.officialReference
      || parseOfficialReference(entry.raw || "")
      || parseOfficialReference(entry.label || "");
    return sameOfficialReference(entryReference, target);
  }) || null;
}

export async function findCachedCelexByOfficialReference(reference) {
  return (await findStoredLawMetaByOfficialReference(reference))?.celex || null;
}
