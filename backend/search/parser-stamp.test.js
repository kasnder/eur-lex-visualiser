const assert = require("node:assert/strict");
const test = require("node:test");

const { isFresh, mergeParserStamp, normalizeParserStamp } = require("./parser-stamp");

test("normalizeParserStamp accepts the shipped stamp shapes and sorts numerically", () => {
  assert.deepEqual(normalizeParserStamp(21), [21]);
  assert.deepEqual(normalizeParserStamp([22, 21, 22]), [21, 22]);
  assert.deepEqual(normalizeParserStamp("21,22"), [21, 22]);
  assert.deepEqual(normalizeParserStamp(" 21, 22 "), [21, 22]);
  assert.deepEqual(normalizeParserStamp("null"), []);
  assert.deepEqual(normalizeParserStamp(null), []);
  assert.deepEqual(normalizeParserStamp(undefined), []);
});

test("mergeParserStamp unions versions while retaining a multi-version container shape", () => {
  assert.deepEqual(mergeParserStamp(21, 22), [21, 22]);
  assert.deepEqual(mergeParserStamp([21], 22), [21, 22]);
  assert.equal(mergeParserStamp("21,22", 22), "21,22");
  assert.equal(mergeParserStamp("null", 22), "null");
  assert.equal(mergeParserStamp(undefined, 22), null);
});

test("isFresh requires a non-empty stamp where every version equals the current parser version", () => {
  assert.equal(isFresh(22, 22), true);
  assert.equal(isFresh([22], 22), true);
  assert.equal(isFresh([21, 22], 22), false);
  assert.equal(isFresh("21,22", 22), false);
  assert.equal(isFresh(21, 22), false);
  assert.equal(isFresh("null", 22), false);
  assert.equal(isFresh(undefined, 22), false);
});
