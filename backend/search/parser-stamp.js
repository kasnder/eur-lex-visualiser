"use strict";

function normalizeVersion(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.toLowerCase() === "null" || !/^\d+$/.test(text)) return null;
  const version = Number(text);
  return Number.isSafeInteger(version) ? version : null;
}

function normalizeParserStamp(value) {
  let candidates;
  if (Array.isArray(value)) {
    candidates = value.flat(Infinity);
  } else if (typeof value === "string" && value.includes(",")) {
    candidates = value.split(",");
  } else {
    candidates = [value];
  }
  return [...new Set(candidates.map(normalizeVersion).filter((version) => version != null))]
    .sort((a, b) => a - b);
}

function mergeParserStamp(existing, current) {
  const existingVersions = normalizeParserStamp(existing);
  // An unstamped legacy asset is not evidence that every record was parsed by
  // the current parser. Preserve that absence so an additive write cannot
  // silently turn it into a falsely fresh singleton stamp.
  if (existingVersions.length === 0) return existing == null ? null : existing;

  const versions = existingVersions;
  for (const version of normalizeParserStamp(current)) {
    if (!versions.includes(version)) versions.push(version);
  }
  versions.sort((a, b) => a - b);
  if (versions.length === 0) return existing == null ? null : existing;
  if (versions.length === 1) return versions[0];
  if (Array.isArray(existing) || Array.isArray(current)) return versions;
  if (typeof existing === "string" || typeof current === "string") return versions.join(",");
  return versions;
}

function isFresh(stamp, current) {
  const currentVersions = normalizeParserStamp(current);
  if (normalizeParserStamp(stamp).length === 0 || currentVersions.length === 0) return false;
  const stampedVersions = normalizeParserStamp(stamp);
  return currentVersions.every((version) => stampedVersions.includes(version));
}

async function getCurrentParserVersion() {
  const parser = await import("../shared/formex-parser/fmxParser.mjs");
  return parser.PARSER_VERSION;
}

module.exports = {
  getCurrentParserVersion,
  isFresh,
  mergeParserStamp,
  normalizeParserStamp,
};
