const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("zlib");

const { streamStats } = require("./json-stream-stats");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "json-stream-stats-"));

function writeJson(name, value, { gzip = false } = {}) {
  const file = path.join(tmp, name);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  fs.writeFileSync(file, gzip ? zlib.gzipSync(text) : text);
  return file;
}

test("counts the records array and hashes the raw bytes", async () => {
  const payload = { generated_at: "now", records: [{ celex: "32016R0679" }, { celex: "32024R1689" }] };
  const file = writeJson("search-cache.json", payload);
  const stats = await streamStats(file);
  assert.equal(stats.count, 2);
  assert.equal(stats.sha256, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
});

test("a gzipped baseline hashes identically to the plain candidate", async () => {
  const payload = { records: [{ celex: "32016R0679" }] };
  const plain = writeJson("plain.json", payload);
  const gz = writeJson("plain.json.gz", payload, { gzip: true });
  assert.deepEqual(await streamStats(gz), await streamStats(plain));
});

test("differing content produces a different digest", async () => {
  const before = writeJson("before.json", { records: [{ celex: "32016R0679" }] });
  const after = writeJson("after.json", { records: [{ celex: "32016R0679" }, { celex: "32024R1689" }] });
  const beforeStats = await streamStats(before);
  const afterStats = await streamStats(after);
  assert.notEqual(beforeStats.sha256, afterStats.sha256);
  assert.equal(afterStats.count - beforeStats.count, 1);
});

test("structural characters inside strings are not counted", async () => {
  const file = writeJson("tricky.json", {
    records: [{ title: 'a, b [c] {d} "quoted"' }, { title: "tail\\\\" }],
  });
  assert.equal((await streamStats(file)).count, 2);
});

test("only a records key starts counting, not a records value or a nested array", async () => {
  const decoy = writeJson("decoy.json", { kind: "records", records: [1, 2, 3, 4] });
  assert.equal((await streamStats(decoy)).count, 4);
  const nested = writeJson("nested.json", { records: [{ inner: { records: [9, 9, 9] } }, { b: 1 }] });
  assert.equal((await streamStats(nested)).count, 2);
});

test("topLevel mode counts the keys of a keyed cache", async () => {
  const file = writeJson("case-law.json", { "62019CJ0311": { name: "a" }, "62020CJ0001": { name: "b" } });
  assert.equal((await streamStats(file, { mode: "topLevel" })).count, 2);
});

test("empty containers count zero members", async () => {
  assert.equal((await streamStats(writeJson("empty-records.json", { records: [] }))).count, 0);
  assert.equal((await streamStats(writeJson("empty-object.json", {}), { mode: "topLevel" })).count, 0);
});

test("a truncated document is rejected rather than silently miscounted", async () => {
  const file = writeJson("truncated.json", '{"records": [{"celex": "32016R0679"}');
  await assert.rejects(streamStats(file), /not a complete JSON document/);
});

test("an unknown mode is rejected", async () => {
  await assert.rejects(streamStats(writeJson("mode.json", { records: [] }), { mode: "nope" }), /Unknown count mode/);
});
