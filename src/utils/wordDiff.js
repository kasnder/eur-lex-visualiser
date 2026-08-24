// Word-level diff for comparing definition wordings. Deliberately
// dependency-free: definitions are normally short, so an O(n*m) LCS over
// words is fast enough and avoids pulling a diff library into the bundle.

const MAX_TOKENS = 400;
// Keep comparison normalization aligned with the definition-index builder:
// canonicalise equivalent Unicode quotes/dashes but preserve case and
// punctuation because the backend treats those as wording differences.
function normalizeToken(token) {
  return String(token || "")
    .trim()
    .normalize("NFKC")
    .replace(/[‘’‛`]/g, "'")
    .replace(/[‐‑‒–—]/g, "-");
}

function tokenize(text) {
  // Attach trailing whitespace to its word. This preserves the target's
  // spacing while allowing removed words to render in their original place.
  return String(text || "").match(/\S+\s*/gu) || [];
}

// Longest common subsequence over the normalized words of both texts.
function lcsTable(baseTokens, targetTokens) {
  const base = baseTokens.map(normalizeToken);
  const target = targetTokens.map(normalizeToken);
  const rows = base.length;
  const cols = target.length;
  const table = Array.from({ length: rows + 1 }, () => new Uint16Array(cols + 1));

  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      table[row][col] = base[row] === target[col]
        ? table[row + 1][col + 1] + 1
        : Math.max(table[row + 1][col], table[row][col + 1]);
    }
  }

  return { base, target, table };
}

function appendSegment(segments, type, text) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last?.type === type) last.text += text;
  else segments.push({ text, type, changed: type !== "unchanged" });
}

// Diff `targetText` against `baseText`. Returned segments contain unchanged
// target text, additions from the target, and removals from the reference.
export function diffWords(baseText, targetText) {
  const baseValue = String(baseText || "");
  const targetValue = String(targetText || "");
  if (baseValue === targetValue) {
    return targetValue ? [{ text: targetValue, type: "unchanged", changed: false }] : [];
  }

  const baseTokens = tokenize(baseValue);
  const targetTokens = tokenize(targetText);

  const segments = [];
  if (baseTokens.length > MAX_TOKENS || targetTokens.length > MAX_TOKENS) {
    appendSegment(segments, "removed", baseValue);
    appendSegment(segments, "added", targetValue);
    return segments;
  }

  const { base, target, table } = lcsTable(baseTokens, targetTokens);
  let baseIndex = 0;
  let targetIndex = 0;
  while (baseIndex < baseTokens.length && targetIndex < targetTokens.length) {
    if (base[baseIndex] === target[targetIndex]) {
      appendSegment(segments, "unchanged", targetTokens[targetIndex]);
      baseIndex += 1;
      targetIndex += 1;
    } else if (table[baseIndex + 1][targetIndex] >= table[baseIndex][targetIndex + 1]) {
      appendSegment(segments, "removed", baseTokens[baseIndex]);
      baseIndex += 1;
    } else {
      appendSegment(segments, "added", targetTokens[targetIndex]);
      targetIndex += 1;
    }
  }
  while (baseIndex < baseTokens.length) {
    appendSegment(segments, "removed", baseTokens[baseIndex]);
    baseIndex += 1;
  }
  while (targetIndex < targetTokens.length) {
    appendSegment(segments, "added", targetTokens[targetIndex]);
    targetIndex += 1;
  }
  return segments;
}
