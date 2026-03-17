const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// FMX files directory - adjust if needed
const FMX_DIR = process.env.FMX_DIR || path.join(__dirname, '..', 'eur-lex-visualiser', 'fmx-downloads');
const CELLAR_BASE = 'https://publications.europa.eu/resource';
const TIMEOUT_MS = 30_000;

// === Rate Limiting ===
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 100; // requests per window
const STORAGE_LIMIT_MB = parseInt(process.env.STORAGE_LIMIT_MB) || 500; // max cache size

const ipRequests = new Map(); // ip -> { count, resetAt }

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

function rateLimitMiddleware(req, res, next) {
  const ip = getIp(req);
  const now = Date.now();
  
  let record = ipRequests.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    ipRequests.set(ip, record);
  }
  
  record.count++;
  
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - record.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));
  
  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ 
      error: 'Too many requests', 
      retryAfter: Math.ceil((record.resetAt - now) / 1000) 
    });
  }
  
  next();
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRequests) {
    if (now > record.resetAt) ipRequests.delete(ip);
  }
}, 5 * 60 * 1000);

// === Storage Management ===

function getCacheSizeMB() {
  try {
    const files = fs.readdirSync(FMX_DIR).filter(f => f.endsWith('.xml') || f.endsWith('.zip'));
    let totalBytes = 0;
    for (const f of files) {
      totalBytes += fs.statSync(path.join(FMX_DIR, f)).size;
    }
    return totalBytes / (1024 * 1024);
  } catch {
    return 0;
  }
}

function getCacheFiles() {
  try {
    const files = fs.readdirSync(FMX_DIR)
      .filter(f => f.endsWith('.xml') || f.endsWith('.zip'))
      .map(f => {
        const stat = fs.statSync(path.join(FMX_DIR, f));
        return { filename: f, path: path.join(FMX_DIR, f), size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => a.mtime - b.mtime); // oldest first
    return files;
  } catch {
    return [];
  }
}

function evictOldestIfNeeded(requiredMB) {
  const currentMB = getCacheSizeMB();
  const limitMB = STORAGE_LIMIT_MB;
  
  if (currentMB + requiredMB <= limitMB) return { evicted: 0 };
  
  const files = getCacheFiles();
  let freedMB = 0;
  let evicted = 0;
  const targetMB = currentMB + requiredMB - limitMB;
  
  for (const file of files) {
    if (freedMB >= targetMB) break;
    fs.unlinkSync(file.path);
    freedMB += file.size / (1024 * 1024);
    evicted++;
    console.log(`[Cache] Evicted ${file.filename} (freed ${(file.size / 1024).toFixed(0)} KB)`);
  }
  
  return { evicted, freedMB: freedMB.toFixed(2) };
}

// Middleware
app.use(cors());
app.use(express.json());

// Ensure download directory exists
if (!fs.existsSync(FMX_DIR)) {
  fs.mkdirSync(FMX_DIR, { recursive: true });
}

// === EUR-Lex Cellar Fetching Logic ===

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function getRdf(url) {
  const r = await fetchWithTimeout(url, {
    headers: { Accept: '*/*', 'Accept-Language': 'eng' }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function extractUris(rdf) {
  return [...rdf.matchAll(/rdf:resource="([^"]+)"/g)].map(m => m[1]);
}

async function findFmx4Uri(celex, lang = 'ENG') {
  const rdf = await getRdf(`${CELLAR_BASE}/celex/${celex}`);
  const uris = extractUris(rdf);

  // Match both old-style (JOL_) and new-style (L_YYYYNNNNN) fmx4 expression URIs
  const pattern = new RegExp(`\\/oj\\/(JOL_\\d{4}_\\d+_R_\\d+|L_\\d{9})\\.${lang}\\.fmx4$`);
  let fmx4 = uris.find(u => pattern.test(u));

  // Fallback: derive from ENG
  if (!fmx4) {
    const engPattern = /\/oj\/(JOL_\d{4}_\d+_R_\d+|L_\d{9})\.ENG\.fmx4$/;
    const engFmx4 = uris.find(u => engPattern.test(u));
    if (engFmx4) {
      fmx4 = engFmx4.replace('.ENG.fmx4', `.${lang}.fmx4`);
    }
  }

  if (!fmx4) throw new Error(`No fmx4 expression URI found for lang=${lang}`);
  return fmx4;
}

async function findDownloadUrls(fmx4Uri) {
  const rdf = await getRdf(fmx4Uri);
  const uris = extractUris(rdf);

  // Prefer zip
  const zip = uris.find(u => u.endsWith('.zip'));
  if (zip) return { type: 'zip', urls: [zip] };

  // Fall back to XML files
  const allXmlFiles = uris.filter(u =>
    u.match(/\.fmx4\.[^/]+\.xml$/) && !u.endsWith('.doc.xml')
  );
  const seen = new Set();
  const xmlFiles = allXmlFiles.filter(u => {
    const suffix = u.split('.fmx4.').pop();
    if (seen.has(suffix)) return false;
    seen.add(suffix);
    return true;
  });

  if (xmlFiles.length) return { type: 'xml', urls: xmlFiles };

  const docXmls = uris.filter(u => u.endsWith('.doc.xml'));
  if (docXmls.length) return { type: 'xml', urls: docXmls };

  throw new Error('No downloadable FMX files found');
}

async function downloadFmx(celex, lang = 'ENG') {
  const fmx4Uri = await findFmx4Uri(celex, lang);
  const { type, urls } = await findDownloadUrls(fmx4Uri);

  const downloaded = [];
  let totalSize = 0;
  
  // First pass: check cache and calculate sizes
  for (const url of urls) {
    const filename = url.split('/').pop();
    const destPath = path.join(FMX_DIR, filename);

    if (fs.existsSync(destPath)) {
      const stat = fs.statSync(destPath);
      downloaded.push({ filename, path: destPath, cached: true, size: stat.size });
    } else {
      // Fetch to get size info
      const r = await fetchWithTimeout(url, { method: 'HEAD' });
      const size = parseInt(r.headers.get('content-length')) || 0;
      totalSize += size;
      downloaded.push({ filename, path: destPath, cached: false, url, size });
    }
  }

  // Evict if needed
  const requiredMB = totalSize / (1024 * 1024);
  if (requiredMB > 0) {
    const { evicted, freedMB } = evictOldestIfNeeded(requiredMB);
    if (evicted > 0) {
      console.log(`[Cache] Evicted ${evicted} file(s), freed ${freedMB} MB`);
    }
  }

  // Second pass: download missing files
  for (const file of downloaded) {
    if (file.cached) continue;
    
    const r = await fetchWithTimeout(file.url);
    if (!r.ok) throw new Error(`HTTP ${r.status} downloading ${file.url}`);
    
    const buffer = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(file.path, buffer);
    file.size = buffer.length;
  }

  return { type, files: downloaded };
}

// CELEX to friendly name mapping
const CELEX_NAMES = {
  '32016R0679': 'GDPR',
  '32024R1689': 'AIA',
  '32022R1925': 'DMA',
  '32022R2065': 'DSA',
  '32022R0868': 'DGA',
  '32023R2854': 'DA'
};

// === API Routes ===

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// List cached laws
app.get('/api/laws', rateLimitMiddleware, (req, res) => {
  try {
    const files = fs.readdirSync(FMX_DIR);
    const laws = files
      .filter(f => f.endsWith('.xml') || f.endsWith('.zip'))
      .map(f => {
        const stat = fs.statSync(path.join(FMX_DIR, f));
        return {
          filename: f,
          size: stat.size,
          modified: stat.mtime
        };
      });
    
    res.json({ count: laws.length, laws });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get law by CELEX (fetches on demand, caches transparently)
app.get('/api/laws/:celex', rateLimitMiddleware, async (req, res) => {
  try {
    const { celex } = req.params;
    const { lang = 'ENG' } = req.query;

    if (!/^\d{4}[A-Z]\d{4}$/.test(celex)) {
      return res.status(400).json({ error: 'Invalid CELEX format. Expected: 32016R0679' });
    }

    console.log(`[API] Fetching ${celex} (lang: ${lang})…`);
    const { type, files } = await downloadFmx(celex, lang);

    if (files.length === 0) {
      return res.status(404).json({ error: `No FMX files found for ${celex}` });
    }

    const file = files[0];
    const stat = fs.statSync(file.path);
    
    res.setHeader('Content-Type', type === 'zip' ? 'application/zip' : 'application/xml');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('X-Filename', file.filename);
    
    fs.createReadStream(file.path).pipe(res);
  } catch (err) {
    console.error(`[API] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Get metadata for a law (no download)
app.get('/api/laws/:celex/info', rateLimitMiddleware, async (req, res) => {
  try {
    const { celex } = req.params;
    const { lang = 'ENG' } = req.query;

    if (!/^\d{4}[A-Z]\d{4}$/.test(celex)) {
      return res.status(400).json({ error: 'Invalid CELEX format' });
    }

    const fmx4Uri = await findFmx4Uri(celex, lang);
    const { type, urls } = await findDownloadUrls(fmx4Uri);

    res.json({
      celex,
      lang,
      name: CELEX_NAMES[celex] || null,
      fmx4Uri,
      type,
      files: urls.map(u => ({
        url: u,
        filename: u.split('/').pop()
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search cached files
app.get('/api/search', rateLimitMiddleware, (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" required' });
    }
    
    const files = fs.readdirSync(FMX_DIR);
    const matches = files
      .filter(f => f.toLowerCase().includes(q.toLowerCase()))
      .map(f => {
        const stat = fs.statSync(path.join(FMX_DIR, f));
        return { filename: f, size: stat.size, modified: stat.mtime };
      });
    
    res.json({ query: q, count: matches.length, results: matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cache status endpoint
app.get('/api/cache', (req, res) => {
  const files = getCacheFiles();
  const totalMB = files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);
  
  res.json({
    storage: {
      usedMB: totalMB.toFixed(2),
      limitMB: STORAGE_LIMIT_MB,
      percentUsed: ((totalMB / STORAGE_LIMIT_MB) * 100).toFixed(1)
    },
    files: files.map(f => ({
      filename: f.filename,
      sizeKB: (f.size / 1024).toFixed(0),
      modified: f.mtime
    }))
  });
});

// Root endpoint with API docs
app.get('/', (req, res) => {
  res.json({
    name: 'EUR-Lex FMX API',
    version: '2.0.0',
    limits: {
      rateLimit: `${RATE_LIMIT_MAX} requests per 15 min per IP`,
      storageLimit: `${STORAGE_LIMIT_MB} MB cache (LRU eviction)`
    },
    endpoints: {
      'GET /': 'This documentation',
      'GET /health': 'Health check',
      'GET /api/cache': 'Cache status and storage usage',
      'GET /api/laws': 'List cached FMX files',
      'GET /api/laws/:celex?lang=ENG': 'Get law by CELEX (fetches & caches)',
      'GET /api/laws/:celex/info': 'Get metadata only',
      'GET /api/search?q=keyword': 'Search cached files'
    },
    celexExamples: {
      '32016R0679': 'GDPR',
      '32024R1689': 'AI Act',
      '32022R1925': 'DMA',
      '32022R2065': 'DSA',
      '32022R0868': 'DGA',
      '32023R2854': 'Data Act'
    },
    languages: ['BUL', 'CES', 'DAN', 'DEU', 'ELL', 'ENG', 'EST', 'FIN', 'FRA', 'GLE', 'HRV', 'HUN', 'ITA', 'LAV', 'LIT', 'MLT', 'NLD', 'POL', 'POR', 'RON', 'SLK', 'SLV', 'SPA', 'SWE']
  });
});

app.listen(PORT, () => {
  console.log(`EUR-Lex FMX API running on port ${PORT}`);
  console.log(`Cache directory: ${FMX_DIR}`);
  console.log(`Rate limit: ${RATE_LIMIT_MAX} req/15min per IP`);
  console.log(`Storage limit: ${STORAGE_LIMIT_MB} MB`);
});
