// Streaming size/identity probe for the large derived caches.
//
// The monthly refresh needs two numbers per cache: how many records it holds,
// and whether it differs from the released baseline. Doing that with jq
// (`jq -er '.records|length'`, `jq -S -c . | sha256sum`) materialises the whole
// document — search-cache.json is already several hundred MB uncompressed and
// grows with every refresh, so each invocation cost multiple GB of runner RAM.
//
// This scanner walks the raw bytes once instead: it counts container members at
// a chosen path and hashes the same bytes as it goes, in constant memory. The
// digest is over the raw bytes rather than a key-sorted canonical form, so a
// formatting-only rewrite would read as "changed" (a harmless extra release);
// identical bytes still mean identical content, which is what the caller acts on.

const crypto = require("crypto");
const fs = require("fs");
const zlib = require("zlib");

// Counting modes:
//   records    -> members of the top-level "records" array ({records: [...]})
//   topLevel   -> members of the top-level object/array (case-law cache)
const MODES = new Set(["records", "topLevel"]);

function createScanner(mode) {
  if (!MODES.has(mode)) throw new Error(`Unknown count mode: ${mode}`);

  let depth = 0; // nesting depth, 0 = outside the root container
  let inString = false;
  let escaped = false;
  let count = 0;
  let counting = mode === "topLevel"; // records mode waits for the key
  let countingDepth = mode === "topLevel" ? 1 : -1;
  let sawMember = false; // a member started at countingDepth
  let keyBuffer = ""; // current string literal, when it may be a key
  let pendingRecordsKey = false;

  function write(chunk) {
    for (let i = 0; i < chunk.length; i += 1) {
      const char = String.fromCharCode(chunk[i]);
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') {
          inString = false;
          if (mode === "records" && !counting && depth === 1) pendingRecordsKey = keyBuffer === "records";
        } else if (mode === "records" && !counting && depth === 1) keyBuffer += char;
        continue;
      }

      switch (char) {
        case '"':
          inString = true;
          escaped = false;
          keyBuffer = "";
          if (depth === countingDepth) sawMember = true;
          break;
        case "{":
        case "[":
          if (depth === countingDepth) sawMember = true;
          depth += 1;
          if (mode === "records" && pendingRecordsKey && char === "[") {
            counting = true;
            countingDepth = depth;
            sawMember = false;
            pendingRecordsKey = false;
          }
          break;
        case "}":
        case "]":
          if (counting && depth === countingDepth) {
            if (sawMember) count += 1; // the final member has no trailing comma
            sawMember = false;
            if (mode === "records") counting = false; // records array closed
          }
          depth -= 1;
          break;
        case ",":
          if (counting && depth === countingDepth) {
            count += 1;
            sawMember = false;
          }
          break;
        case " ":
        case "\t":
        case "\n":
        case "\r":
        case ":":
          break;
        default:
          if (depth === countingDepth) sawMember = true;
          break;
      }
    }
  }

  return {
    write,
    result: () => ({ count, complete: depth === 0 }),
  };
}

function streamStats(inputPath, { mode = "records", gunzip = null } = {}) {
  const isGzip = gunzip === null ? inputPath.toLowerCase().endsWith(".gz") : gunzip;

  return new Promise((resolve, reject) => {
    // Inside the executor so a bad mode rejects like any other input error.
    const scanner = createScanner(mode);
    const hash = crypto.createHash("sha256");
    const source = inputPath === "-" ? process.stdin : fs.createReadStream(inputPath);
    // The digest covers the decompressed bytes so a gzipped baseline and a
    // plain candidate stay directly comparable.
    const plain = isGzip ? source.pipe(zlib.createGunzip()) : source;
    plain.on("data", (chunk) => {
      hash.update(chunk);
      scanner.write(chunk);
    });
    plain.on("error", reject);
    source.on("error", reject);
    plain.on("end", () => {
      const { count, complete } = scanner.result();
      if (!complete) {
        reject(new Error(`${inputPath} is not a complete JSON document`));
        return;
      }
      resolve({ count, sha256: hash.digest("hex") });
    });
  });
}

function parseArgs(argv) {
  const args = { input: null, mode: "records", gunzip: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") args.mode = argv[++i];
    else if (arg === "--gunzip") args.gunzip = true;
    else if (arg === "--no-gunzip") args.gunzip = false;
    else if (!args.input) args.input = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!args.input) throw new Error("Usage: node search/json-stream-stats.js <file|-> [--mode records|topLevel] [--gunzip]");
  return args;
}

async function main() {
  const { input, mode, gunzip } = parseArgs(process.argv.slice(2));
  const stats = await streamStats(input, { mode, gunzip });
  process.stdout.write(`${JSON.stringify(stats)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[json-stream-stats] fatal: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { createScanner, streamStats, parseArgs };
