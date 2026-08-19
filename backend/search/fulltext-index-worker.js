// Persistent worker for fulltext-index-build.js. Unlike
// definition-index-worker.js (one worker per batch via workerData), this
// worker stays alive across many batches — the pool posts a batch of corpus
// files, the worker parses them into unit rows via the DI'd
// buildFulltextShard, and posts the shard back. buildFulltextShard catches
// per-file failures internally, so a "message" from here is always a
// completed shard; only a worker crash (OOM) surfaces as an "error"/"exit"
// event on the parent side.
const { parentPort } = require("worker_threads");
const { buildFulltextShard } = require("./fulltext-index-build");

parentPort.on("message", async (files) => {
  const shard = await buildFulltextShard({ files });
  parentPort.postMessage(shard);
});
