const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const backendDir = path.join(__dirname, "..");
const cliPath = path.join(__dirname, "eurlex.js");
const fixturePath = path.join(backendDir, "search", "__fixtures__", "search-fixture.json");

async function runCli(args, env = {}) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: backendDir,
    env: {
      ...process.env,
      ...env,
    },
  });
}

function createFetchBlocker() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eurlex-cli-fetch-"));
  const modulePath = path.join(tempDir, "block-fetch.js");
  fs.writeFileSync(modulePath, "global.fetch = async () => { throw new Error('fetch should not be called'); };\n", "utf8");
  return modulePath;
}

test("eurlex search uses the configured cache file", async () => {
  const { stdout } = await runCli(["search", "payment services directive"], {
    SEARCH_CACHE_PATH: fixturePath,
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.results[0]?.celex, "32015L2366");
});

test("eurlex search fails cleanly when cache file is unavailable", async () => {
  await assert.rejects(
    runCli(["search", "gdpr"], {
      SEARCH_CACHE_PATH: path.join(os.tmpdir(), `missing-cache-${Date.now()}.json`),
    }),
    (error) => {
      assert.match(error.stderr, /Search cache not available/);
      return true;
    }
  );
});

test("eurlex resolve uses the legal cache before network fetches", async () => {
  const fetchBlocker = createFetchBlocker();
  const { stdout } = await runCli(["resolve", "Directive 2015/2366"], {
    NODE_OPTIONS: `--require ${fetchBlocker}`,
    SEARCH_CACHE_PATH: fixturePath,
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.resolved?.celex, "32015L2366");
  assert.equal(payload.resolved?.source, "search-cache");
});

test("eurlex resolve-url uses the legal cache before network fetches", async () => {
  const fetchBlocker = createFetchBlocker();
  const { stdout } = await runCli(["resolve-url", "https://eur-lex.europa.eu/eli/dir/2015/2366/oj"], {
    NODE_OPTIONS: `--require ${fetchBlocker}`,
    SEARCH_CACHE_PATH: fixturePath,
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.resolved?.celex, "32015L2366");
  assert.equal(payload.resolved?.source, "search-cache");
});

test("eurlex resolve rejects an invalid --lang instead of silently defaulting to ENG", async () => {
  await assert.rejects(
    runCli(["resolve", "Directive 2015/2366", "--lang", "XX"], {
      SEARCH_CACHE_PATH: fixturePath,
    }),
    (error) => {
      assert.match(error.stderr, /Invalid language code: XX/);
      return true;
    }
  );
});

test("eurlex resolve-url rejects an invalid --lang instead of silently defaulting to ENG", async () => {
  await assert.rejects(
    runCli(["resolve-url", "https://eur-lex.europa.eu/eli/dir/2015/2366/oj", "--lang", "XX"], {
      SEARCH_CACHE_PATH: fixturePath,
    }),
    (error) => {
      assert.match(error.stderr, /Invalid language code: XX/);
      return true;
    }
  );
});
