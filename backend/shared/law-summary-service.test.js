const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildLawSummaryInput,
  ensureLawSummary,
  parseLawSummaryJson,
} = require('./law-summary-service');

function sampleParsedLaw() {
  return {
    celex: '32016R0679',
    lang: 'ENG',
    title: 'Regulation (EU) 2016/679',
    source: 'test',
    articles: [
      {
        article_number: '1',
        article_title: 'Subject matter and objectives',
        article_html: '<p>This Regulation lays down rules relating to personal data.</p>',
        division: { chapter: { title: 'General provisions' } },
      },
      {
        article_number: '5',
        article_title: 'Principles relating to processing',
        article_html: '<p>Personal data shall be processed lawfully, fairly and transparently.</p>',
        division: { chapter: { title: 'Principles' } },
      },
    ],
    recitals: [{ recital_number: '1', recital_text: 'Protection of natural persons.' }],
    definitions: [{ term: 'personal data', sourceArticle: '4' }],
    crossReferences: {
      1: [{ type: 'external', raw: 'Directive 95/46/EC', target: 'Directive 95/46/EC' }],
    },
  };
}

test('parseLawSummaryJson keeps only valid article citations and related instruments', () => {
  const input = buildLawSummaryInput(sampleParsedLaw());
  const summary = parseLawSummaryJson(JSON.stringify({
    purpose: { text: 'It protects personal data.', citations: ['1', '999'] },
    scope: { text: 'It applies to personal data processing.', citations: ['1'] },
    keyPoints: [
      { text: 'Data must be processed lawfully.', citations: ['5'] },
      { text: 'Invalid point is dropped.', citations: ['999'] },
    ],
    structure: 'It starts with general provisions and then sets principles.',
    relatedInstruments: [
      { label: 'Directive 95/46/EC', celex: '31995L0046', relationship: 'Predecessor data-protection framework.' },
      { label: 'Invented Act', celex: '39999X0000', relationship: 'Should be rejected.' },
    ],
  }), input);

  assert.deepEqual(summary.purpose.citations, ['1']);
  assert.deepEqual(summary.keyPoints.map((item) => item.citations), [['5']]);
  assert.equal(summary.relatedInstruments.length, 1);
  assert.equal(summary.relatedInstruments[0].celex, '31995L0046');
});

test('ensureLawSummary caches validated summaries', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-summary-service-'));
  let calls = 0;
  const chatComplete = async () => {
    calls++;
    return {
      model: 'test-model',
      usage: { total_tokens: 10 },
      text: JSON.stringify({
        purpose: { text: 'It protects personal data.', citations: ['1'] },
        scope: { text: 'It applies to personal data processing.', citations: ['1'] },
        keyPoints: [{ text: 'Data must be processed lawfully.', citations: ['5'] }],
        structure: 'It starts with general provisions and then sets principles.',
        relatedInstruments: [{ label: 'Directive 95/46/EC', celex: '31995L0046', relationship: 'Predecessor framework.' }],
      }),
    };
  };

  const first = await ensureLawSummary({
    celex: '32016R0679',
    lang: 'ENG',
    parsedLaw: sampleParsedLaw(),
    cacheDir,
    apiKey: 'test-key',
    model: 'test-model',
    chatComplete,
  });
  const second = await ensureLawSummary({
    celex: '32016R0679',
    lang: 'ENG',
    parsedLaw: sampleParsedLaw(),
    cacheDir,
    apiKey: null,
    model: 'test-model',
    chatComplete,
  });

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

function repeatedSentences(targetChars) {
  let text = '';
  let n = 1;
  while (text.length < targetChars) {
    text += `Sentence number ${n} provides that data shall be processed lawfully and fairly. `;
    n += 1;
  }
  return text;
}

test('article text is clipped at a sentence boundary, not mid-word', () => {
  const parsedLaw = sampleParsedLaw();
  parsedLaw.articles[0].article_html = `<p>${repeatedSentences(8000)}</p>`;

  const input = buildLawSummaryInput(parsedLaw);
  const clipped = input.articles.find((article) => article.number === '1').text;

  assert.ok(clipped.length <= 6001, `expected clipped text near the 6000-char cap, got ${clipped.length}`);
  assert.ok(clipped.endsWith('.…'), `expected a full sentence before the ellipsis, got: ...${clipped.slice(-40)}`);
});

test('overall article budget drops bodies but keeps every article number citable', () => {
  const parsedLaw = sampleParsedLaw();
  const totalArticles = 90;
  parsedLaw.articles = Array.from({ length: totalArticles }, (_, i) => ({
    article_number: String(i + 1),
    article_title: `Article ${i + 1}`,
    article_html: `<p>${repeatedSentences(6500)}</p>`,
    division: { chapter: { title: 'General provisions' } },
  }));

  const input = buildLawSummaryInput(parsedLaw);

  assert.equal(input.skeleton.length, totalArticles, 'skeleton must retain every article number');
  assert.ok(input.articles.length < totalArticles, 'article bodies should be dropped once the budget is exceeded');

  const keptNumbers = new Set(input.articles.map((article) => article.number));
  const droppedArticle = input.skeleton.find((article) => !keptNumbers.has(article.number));
  assert.ok(droppedArticle, 'expected at least one article whose body was trimmed away');

  const summary = parseLawSummaryJson(JSON.stringify({
    purpose: { text: 'It protects personal data.', citations: [droppedArticle.number] },
    scope: { text: 'It applies broadly.', citations: [droppedArticle.number] },
    keyPoints: [{ text: 'A rule still cites a body-trimmed article.', citations: [droppedArticle.number] }],
    structure: 'It is organised into many articles.',
    relatedInstruments: [],
  }), input);

  assert.deepEqual(summary.scope.citations, [droppedArticle.number]);
  assert.deepEqual(summary.keyPoints[0].citations, [droppedArticle.number]);
});

test('actType is derived from the CELEX descriptor letter', () => {
  const base = sampleParsedLaw();

  assert.equal(buildLawSummaryInput({ ...base, celex: '32016R0679' }).actType, 'regulation');
  assert.equal(buildLawSummaryInput({ ...base, celex: '32019L0790' }).actType, 'directive');
  assert.equal(buildLawSummaryInput({ ...base, celex: '32021D2054' }).actType, 'decision');
  assert.equal(buildLawSummaryInput({ ...base, celex: null }).actType, 'unknown');
});
