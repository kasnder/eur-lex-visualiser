import { LAWS } from "../constants/laws.js";
import { normalizeUiLocale } from "../i18n/localeMeta.js";

const VALID_ACT_TYPES = new Set(["regulation", "directive", "decision"]);

function slugifySegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeOfficialReference(reference) {
  if (!reference) return null;
  const actType = String(reference.actType || "").trim().toLowerCase();
  const year = String(reference.year || "").trim();
  const number = String(reference.number || "").trim();

  if (!VALID_ACT_TYPES.has(actType) || !/^\d{4}$/.test(year) || !/^\d{1,4}$/.test(number)) {
    return null;
  }

  return { actType, year, number };
}

function buildOfficialReferenceSlug(reference) {
  const normalized = normalizeOfficialReference(reference);
  if (!normalized) return null;
  return `${normalized.actType}-${normalized.year}-${normalized.number}`;
}

function buildImportedLawSlug(entry) {
  const reference = normalizeOfficialReference(entry?.officialReference);
  if (reference) return buildOfficialReferenceSlug(reference);
  return null;
}

export function getLawSlug(law) {
  const shortname = slugifySegment(law?.shortname);
  if (shortname) return shortname;

  if (law?.celex) {
    const bundledMatch = LAWS.find((entry) => entry.celex === law.celex && slugifySegment(entry.shortname));
    if (bundledMatch) return slugifySegment(bundledMatch.shortname);
  }

  return buildOfficialReferenceSlug(law?.officialReference);
}

export function enrichLaw(law) {
  const officialReference = normalizeOfficialReference(law?.officialReference);
  const slug = getLawSlug({ ...law, officialReference });

  return {
    ...law,
    officialReference,
    shownInUi: law?.shownInUi !== false,
    slug,
  };
}

const ENRICHED_LAWS = LAWS.map(enrichLaw);
const LAWS_BY_KEY = new Map(ENRICHED_LAWS.map((law) => [law.key, law]));
const LAWS_BY_CELEX = new Map(ENRICHED_LAWS.filter((law) => law.celex).map((law) => [law.celex, law]));
const LAWS_BY_SLUG = new Map(ENRICHED_LAWS.filter((law) => law.slug).map((law) => [law.slug, law]));

export function getBundledLaws() {
  return ENRICHED_LAWS;
}

export function findBundledLawByKey(key) {
  return key ? LAWS_BY_KEY.get(key) || null : null;
}

export function findBundledLawByCelex(celex) {
  return celex ? LAWS_BY_CELEX.get(celex) || null : null;
}

export function findBundledLawBySlug(slug) {
  return slug ? LAWS_BY_SLUG.get(slug) || null : null;
}

export function getCanonicalLawRoute(law, kind = null, id = null, locale = "en") {
  const slug = getLawSlug(law);
  if (!slug) return "/";
  const base = normalizeUiLocale(locale) === "en" ? `/${slug}` : `/${normalizeUiLocale(locale)}/${slug}`;
  if (kind && id != null) return `${base}/${kind}/${encodeURIComponent(String(id))}`;
  return base;
}

export function buildImportedLawCandidate(entry = {}) {
  const bundled = findBundledLawByCelex(entry.celex);
  if (bundled) return bundled;

  const officialReference = normalizeOfficialReference(entry.officialReference);
  const slug = buildImportedLawSlug({ ...entry, officialReference });

  return {
    ...entry,
    officialReference,
    slug,
  };
}

export function getActTypeChoices() {
  return Array.from(VALID_ACT_TYPES);
}

export function parseOfficialReferenceSlug(slug) {
  const match = String(slug || "").match(/^(regulation|directive|decision)-(\d{4})-(\d{1,4})$/);
  if (!match) return null;

  return {
    actType: match[1],
    year: match[2],
    number: match[3],
  };
}
