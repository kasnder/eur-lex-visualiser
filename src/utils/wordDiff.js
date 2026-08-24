// Word-level diff for comparing definition wordings side by side. Deliberately
// dependency-free: definitions are 30-80 words, so an O(n*m) LCS over words is
// more than fast enough and avoids pulling a diff library into the bundle.

const MAX_TOKENS = 400;
const WORD_SPLIT = /(\s+)/;

// Compare tokens case-insensitively, ignoring surrounding punctuation, so
// "economy;" in one act matches "economy." in another.
function normalizeWord(word) {
  return String(word || "")
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function tokenize(text) {
  return String(text || "").split(WORD_SPLIT).filter(Boolean);
}

// Longest common subsequence over the normalized words of both texts.
// Returns a Set of target token indexes that are part of the LCS.
function lcsMatchedTargetIndexes(baseTokens, targetTokens) {
  const base = baseTokens.map(normalizeWord);
  const target = targetTokens.map(normalizeWord);
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

  const matched = new Set();
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (base[row] === target[col]) {
      matched.add(col);
      row += 1;
      col += 1;
    } else if (table[row + 1][col] >= table[row][col + 1]) {
      row += 1;
    } else {
      col += 1;
    }
  }
  return matched;
}

// Diff `targetText` against `baseText`: returns the target split into segments
// of adjacent tokens sharing a `changed` flag. Whitespace-only segments are
// never marked changed, so highlights never wrap spaces.
export function diffWords(baseText, targetText) {
  const baseTokens = tokenize(baseText).filter((token) => /\S/.test(token));
  const targetTokens = tokenize(targetText);
  const wordCount = targetTokens.filter((token) => /\S/.test(token)).length;

  const matched = baseTokens.length && wordCount && wordCount <= MAX_TOKENS && baseTokens.length <= MAX_TOKENS
    ? lcsMatchedTargetIndexes(baseTokens, targetTokens)
    : new Set();

  const segments = [];
  for (let index = 0; index < targetTokens.length; index++) {
    const token = targetTokens[index];
    const changed = /\S/.test(token) && !matched.has(index);
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) last.text += token;
    else segments.push({ text: token, changed });
  }

  // A single space between two changed words belongs inside the highlight
  // ("real economy" as one mark): mark such bridges changed, then merge.
  for (let index = 1; index < segments.length - 1; index++) {
    const segment = segments[index];
    if (!segment.changed && !/\S/.test(segment.text) && segments[index - 1].changed && segments[index + 1].changed) {
      segment.changed = true;
    }
  }

  const merged = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.changed === segment.changed) last.text += segment.text;
    else merged.push({ ...segment });
  }
  return merged;
}
