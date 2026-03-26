const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEliCandidates,
  extractCelexFromText,
  parseEurlexUrl,
  parseReferenceText,
  parseStructuredReference,
  validateCelex,
} = require('./reference-utils');

test('parseReferenceText extracts act type and year/number', () => {
  const parsed = parseReferenceText('Regulation (EU) 2016/679 on data protection');
  assert.equal(parsed.actType, 'regulation');
  assert.equal(parsed.year, '2016');
  assert.equal(parsed.number, '679');
});

test('parseStructuredReference normalizes structured fields', () => {
  const parsed = parseStructuredReference({
    actType: 'Directive',
    year: 2018,
    number: 1972,
    suffix: 'jha',
    ojColl: 'l',
    ojNo: '321',
    ojYear: '2018',
  });
  assert.equal(parsed.actType, 'directive');
  assert.equal(parsed.suffix, 'JHA');
  assert.equal(parsed.ojColl, 'L');
  assert.equal(parsed.normalized, 'directive 2018 1972');
});

test('extractCelexFromText finds CELEX in raw and encoded forms', () => {
  assert.equal(extractCelexFromText('foo CELEX:32016R0679 bar'), '32016R0679');
  assert.equal(extractCelexFromText('foo CELEX%3A32022R2065 bar'), '32022R2065');
});

test('parseEurlexUrl recognizes direct CELEX URLs', () => {
  const parsed = parseEurlexUrl('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679');
  assert.equal(parsed.type, 'celex');
  assert.equal(parsed.celex, '32016R0679');
});

test('parseEurlexUrl recognizes ELI URLs', () => {
  const parsed = parseEurlexUrl('https://eur-lex.europa.eu/eli/reg/2016/679/oj');
  assert.equal(parsed.type, 'eli');
  assert.equal(parsed.reference.actType, 'regulation');
  assert.equal(parsed.reference.year, '2016');
  assert.equal(parsed.reference.number, '679');
});

test('buildEliCandidates handles decision JHA suffix', () => {
  const candidates = buildEliCandidates({
    actType: 'decision',
    year: '2008',
    number: '977',
    suffix: 'JHA',
  });
  assert.ok(candidates.includes('http://publications.europa.eu/resource/eli/dec_framw/2008/977/oj'));
  assert.ok(candidates.includes('http://publications.europa.eu/resource/eli/dec/2008/977/oj'));
});

test('validateCelex accepts canonical CELEX format', () => {
  assert.equal(validateCelex('32016R0679'), true);
  assert.equal(validateCelex('32016R0679(01)'), true);
  assert.equal(validateCelex('GDPR'), false);
});
