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

// The shard carries this worker's isolate heap back to the parent. Each
// worker_threads worker gets its own V8 isolate, so process.memoryUsage()
// here reports this worker's heap rather than the whole process — which is
// exactly the number that matters, since resourceLimits caps each worker
// individually and a worker approaching its cap starts full-GCing on every
// batch. Whole-machine sampling cannot see that: the RSS stays flat at the
// ceiling while throughput collapses.
// parseMs is this batch's share of the parallel half of the build. The
// parent times the serialized half (its own insert) against it, which is the
// one split the progress line cannot infer: both workers sit idle across the
// parent's insert, because runPool only reassigns a worker after onResult
// returns.
parentPort.on("message", async (files) => {
  const startedAt = process.hrtime.bigint();
  const shard = await buildFulltextShard({ files });
  shard.parseMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  shard.heapUsedMb = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
  parentPort.postMessage(shard);
});
