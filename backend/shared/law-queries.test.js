const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  fetchCaseLaw,
  fetchConsolidatedVersions,
  fetchTransposition,
  fetchLegislativeProcedure,
  parseCitationsToRefs,
} = require("./law-queries");

test('fetchTransposition queries national implementing measures and maps optional fields', async () => {
  let query = '';
  const payload = await fetchTransposition('32019L0633', async (value) => {
    query = value;
    return {
      results: {
        bindings: [
          {
            measureCelex: { value: '72019L0633POL_202006400' },
            country: { value: 'http://publications.europa.eu/resource/authority/country/POL' },
            title: { value: 'Ustawa o zmianie ustawy' },
            notificationDate: { value: '2020-08-11' },
            nationalId: { value: '2018/640' },
            nationalLink: { value: 'https://example.pl/measure' },
            eli: { value: 'https://eli.example.pl/measure' },
          },
          {
            measureCelex: { value: '72019L0633FRA_202006401' },
          },
          {
            measureCelex: { value: '7*EST_202103476' },
            country: { value: 'http://publications.europa.eu/resource/authority/country/EST' },
            title: { value: 'Mitut direktiivi rakendav meede' },
          },
          // Same Commission SG suffix: retain the newest binding only.
          {
            measureCelex: { value: '72019L0633BEL_202006400' },
            title: { value: 'Duplicate notification' },
          },
          { measureCelex: { value: 'malformed' } },
          {},
        ],
      },
    };
  });

  assert.match(query, /measure_national_implementing_implements_resource_legal/);
  assert.match(query, /measure_national_implementing_date_notification/);
  assert.match(query, /measure_national_implementing_national_website_link/);
  assert.match(query, /GROUP BY \?sgId/);
  assert.match(query, /ORDER BY DESC\(\?notificationDate\)/);
  assert.match(query, /LIMIT 201/);
  assert.deepEqual(payload, {
    celex: '32019L0633',
    applicable: true,
    measures: [
      {
        celex: '72019L0633POL_202006400',
        sgId: '202006400',
        country: 'POL',
        title: 'Ustawa o zmianie ustawy',
        notificationDate: '2020-08-11',
        nationalId: '2018/640',
        nationalLink: 'https://example.pl/measure',
        eli: 'https://eli.example.pl/measure',
      },
      {
        celex: '72019L0633FRA_202006401',
        sgId: '202006401',
        country: null,
        title: null,
        notificationDate: null,
        nationalId: null,
        nationalLink: null,
        eli: null,
      },
      {
        celex: '7*EST_202103476',
        sgId: '202103476',
        country: 'EST',
        title: 'Mitut direktiivi rakendav meede',
        notificationDate: null,
        nationalId: null,
        nationalLink: null,
        eli: null,
      },
    ],
    truncated: false,
  });
});

test('fetchTransposition caps unique measures at 200 and exposes truncation', async () => {
  const bindings = Array.from({ length: 201 }, (_, index) => ({
    measureCelex: { value: `72019L0633POL_${String(index).padStart(9, '0')}` },
    notificationDate: { value: `2020-01-${String((index % 28) + 1).padStart(2, '0')}` },
  }));
  const payload = await fetchTransposition('32019L0633', async () => ({ results: { bindings } }));

  assert.equal(payload.measures.length, 200);
  assert.equal(payload.truncated, true);
  assert.equal(payload.measures[0].sgId, '000000000');
  assert.equal(payload.measures[199].sgId, '000000199');
});

test('fetchTransposition skips CELLAR for non-directives', async () => {
  let calls = 0;
  const runSparqlQuery = async () => {
    calls += 1;
    return { results: { bindings: [] } };
  };

  assert.deepEqual(await fetchTransposition('32016R0679', runSparqlQuery), {
    celex: '32016R0679', applicable: false, measures: [], truncated: false,
  });
  assert.deepEqual(await fetchTransposition('32022D0001', runSparqlQuery), {
    celex: '32022D0001', applicable: false, measures: [], truncated: false,
  });
  assert.equal(calls, 0);
});

test("fetchCaseLaw reads precomputed details from the data store and never writes", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "case-law-cache-"));
  const caseCelex = "61999CJ0465";
  let requestedIds = [];
  const payload = await fetchCaseLaw("31995L0046", async () => ({
    results: {
      bindings: [
        {
          caseCelex: { value: caseCelex },
          ecli: { value: "ECLI:EU:C:2000:000" },
          date: { value: "2000-05-01" },
        },
      ],
    },
  }), {
    cacheDir,
    dataStore: {
      getCaseLawDetails(ids) {
        requestedIds = ids;
        return new Map([[caseCelex, {
        name: "Example v Example",
        declarations: [{ number: 1, text: "Example ruling." }],
        articlesCited: ["Art. 6 GDPR"],
        articleRefs: parseCitationsToRefs(["Art. 6 GDPR"]),
        }]]);
      },
    },
  });

  assert.deepEqual(requestedIds, [caseCelex]);
  assert.equal(payload.celex, "31995L0046");
  assert.equal(payload.cases.length, 1);
  assert.equal(payload.cases[0].name, "Example v Example");
  assert.deepEqual(payload.cases[0].declarations, [{ number: 1, text: "Example ruling." }]);
  assert.deepEqual(fs.readdirSync(cacheDir), []);
});

test("parseCitationsToRefs handles plain, paragraph, point, and 95/46-style tokens", () => {
  const refs = parseCitationsToRefs([
    "Art. 6 GDPR",
    "Art. 6(1) GDPR",
    "Art. 6(1)(a) GDPR",
    "Art. 7(a) 95/46",
    "Art. 267 TFEU",
  ]);
  assert.deepEqual(refs, [
    { raw: "Art. 6 GDPR", act: "GDPR", actCelex: "32016R0679", article: "6", paragraph: null, point: null },
    { raw: "Art. 6(1) GDPR", act: "GDPR", actCelex: "32016R0679", article: "6", paragraph: "1", point: null },
    { raw: "Art. 6(1)(a) GDPR", act: "GDPR", actCelex: "32016R0679", article: "6", paragraph: "1", point: "a" },
    { raw: "Art. 7(a) 95/46", act: "95/46", actCelex: "31995L0046", article: "7", paragraph: null, point: "a" },
    { raw: "Art. 267 TFEU", act: "TFEU", actCelex: "12012E", article: "267", paragraph: null, point: null },
  ]);
});

test("parseCitationsToRefs resolves actCelex for all mapped acts", () => {
  const cases = [
    ["Art. 5 2002/58",   "32002L0058"],
    ["Art. 1 2016/680",  "32016L0680"],
    ["Art. 8 Charter",   "12012P"],
    ["Art. 5 2016/679",  "32016R0679"],
    ["Art. 3 TEU",       "12012M"],
    ["Art. 1 2022/2065", "32022R2065"],
    ["Art. 1 2022/1925", "32022R1925"],
    ["Art. 1 2024/1689", "32024R1689"],
    ["Art. 1 2016/943",  null],   // unmapped — left null
  ];
  for (const [str, expectedCelex] of cases) {
    const refs = parseCitationsToRefs([str]);
    assert.equal(refs.length, 1, `expected one ref for "${str}"`);
    assert.equal(refs[0].actCelex, expectedCelex, `actCelex mismatch for "${str}"`);
  }
});

test("parseCitationsToRefs splits composite 'N and M' / 'N, M and P' strings", () => {
  const refs = parseCitationsToRefs([
    "Art. 45 and 46 GDPR",
    "Art. 5, 6 and 10 GDPR",
  ]);
  assert.equal(refs.length, 5);
  assert.deepEqual(
    refs.map((r) => ({ art: r.article, raw: r.raw })),
    [
      { art: "45", raw: "Art. 45 and 46 GDPR" },
      { art: "46", raw: "Art. 45 and 46 GDPR" },
      { art: "5", raw: "Art. 5, 6 and 10 GDPR" },
      { art: "6", raw: "Art. 5, 6 and 10 GDPR" },
      { art: "10", raw: "Art. 5, 6 and 10 GDPR" },
    ]
  );
});

test("parseCitationsToRefs deduplicates repeated (act, article, paragraph, point) tuples", () => {
  const refs = parseCitationsToRefs([
    "Art. 6(1)(a) GDPR",
    "Art. 6(1)(a) GDPR",
  ]);
  assert.equal(refs.length, 1);
});

test("parseCitationsToRefs tolerates malformed strings without throwing", () => {
  const refs = parseCitationsToRefs([
    "",
    "not a citation",
    "Article 6 of Regulation (EU) 2016/679", // long form, not compact
    null,
  ]);
  assert.deepEqual(refs, []);
});

test("fetchCaseLaw reads a legacy v4 cache without writing a migrated file", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "case-law-cache-"));
  const caseCelex = "62019CJ0439";

  // Seed a v4-style cache file. It has structured refs but no parser version,
  // so it is returned immediately and refreshed in the background.
  const v4Path = path.join(cacheDir, "case-law-cache-v4.json");
  fs.writeFileSync(v4Path, JSON.stringify({
    [caseCelex]: {
      name: "B v Latvijas Republikas Saeima",
      declarations: [{ number: 1, text: "The Court rules." }],
      articlesCited: ["Art. 5, 6 and 10 GDPR"],
      articleRefs: parseCitationsToRefs(["Art. 5, 6 and 10 GDPR"]),
    },
  }));

  const payload = await fetchCaseLaw("32016R0679", async () => ({
    results: {
      bindings: [
        {
          caseCelex: { value: caseCelex },
          ecli: { value: "ECLI:EU:C:2021:504" },
          date: { value: "2021-06-22" },
        },
      ],
    },
  }), {
    cacheDir,
  });

  const caseEntry = payload.cases[0];
  assert.equal(caseEntry.articleRefs.length, 3);
  assert.deepEqual(
    caseEntry.articleRefs.map((r) => r.article),
    ["5", "6", "10"]
  );

  const v5Path = path.join(cacheDir, "case-law-cache-v5.json");
  assert.equal(fs.existsSync(v5Path), false);
});

test('fetchCaseLaw includes and formats General Court judgments', async () => {
  let query = '';
  const payload = await fetchCaseLaw('32022R2065', async (value) => {
    query = value;
    return {
      results: {
        bindings: [{
          caseCelex: { value: '62025TJ0123' },
          ecli: { value: 'ECLI:EU:T:2026:1' },
          date: { value: '2026-01-01' },
        }],
      },
    };
  });

  assert.match(query, /\(CJ\|TJ\)/);
  assert.equal(payload.cases[0].caseNumber, 'T-123/25');
});

test('fetchConsolidatedVersions maps point-in-time CELEX ids to dated versions', async () => {
  let query = '';
  const payload = await fetchConsolidatedVersions('32013R0575', async (value) => {
    query = value;
    return {
      results: {
        bindings: [
          { id: { value: '02013R0575-20260626' } },
          { id: { value: '02013R0575-20130628' } },
          // Neighbouring acts share the id prefix up to the separator; the
          // base must match exactly or 32013R0575 would absorb 32013R05750.
          { id: { value: '02013R05750-20200101' } },
          { id: { value: 'not-a-celex' } },
        ],
      },
    };
  });

  assert.match(query, /STRSTARTS\(STR\(\?id\), "02013R0575-"\)/);
  assert.equal(payload.base, '02013R0575');
  assert.deepEqual(payload.versions, [
    { celex: '02013R0575-20130628', date: '2013-06-28' },
    { celex: '02013R0575-20260626', date: '2026-06-26' },
  ]);
});

test('fetchConsolidatedVersions skips SPARQL for CELEX ids that cannot be consolidated', async () => {
  let called = false;
  // Already a point-in-time consolidated id itself (sector 0 + trailing
  // date) — not shaped like an original act, so it must not be re-consolidated.
  const payload = await fetchConsolidatedVersions('02013R0575-20260626', async () => {
    called = true;
    return { results: { bindings: [] } };
  });

  assert.equal(called, false);
  assert.equal(payload.base, null);
  assert.deepEqual(payload.versions, []);
});

test('fetchConsolidatedVersions matches a suffixed original act, not just sector 3', async () => {
  let query = '';
  const payload = await fetchConsolidatedVersions('31999F0130(06)', async (value) => {
    query = value;
    return {
      results: {
        bindings: [
          { id: { value: '01999F0130(06)-20021220' } },
        ],
      },
    };
  });

  assert.match(query, /STRSTARTS\(STR\(\?id\), "01999F0130\(06\)-"\)/);
  assert.equal(payload.base, '01999F0130(06)');
  assert.deepEqual(payload.versions, [
    { celex: '01999F0130(06)-20021220', date: '2002-12-20' },
  ]);
});

test('fetchConsolidatedVersions matches a sector-2 international agreement', async () => {
  const payload = await fetchConsolidatedVersions('21994A0103(01)', async () => ({
    results: {
      bindings: [
        { id: { value: '01994A0103(01)-20160519' } },
      ],
    },
  }));

  assert.equal(payload.base, '01994A0103(01)');
  assert.deepEqual(payload.versions, [
    { celex: '01994A0103(01)-20160519', date: '2016-05-19' },
  ]);
});

test('fetchLegislativeProcedure maps the relation-scoped binding set', async () => {
  let query = '';
  const payload = await fetchLegislativeProcedure('32016R0679', async (value) => {
    query = value;
    return {
      results: {
        bindings: [
          {
            documentCelex: { value: '32016R0679' },
            stage: { value: 'final' },
            date: { value: '2016-05-04' },
            procedureReference: { value: '2012/0011 (COD)' },
          },
          {
            documentCelex: { value: '52012PC0011' },
            stage: { value: 'proposal' },
            institution: { value: 'European Commission' },
            date: { value: '2012-03-09' },
            documentTitle: { value: 'Commission proposal' },
            procedureReference: { value: 'COD 2012/0011' },
          },
          {
            documentCelex: { value: '52014AP0212' },
            stage: { value: 'ep' },
            institution: { value: 'European Parliament' },
            date: { value: '2014-04-15' },
            documentTitle: { value: 'Parliament position' },
          },
          {
            documentCelex: { value: '52016AG0006(01)' },
            stage: { value: 'council' },
            institution: { value: 'Council of the European Union' },
            date: { value: '2016-04-08' },
            documentTitle: { value: 'Council position' },
          },
          // Multiple agents/expressions can create duplicate rows in Cellar.
          {
            documentCelex: { value: '52016AG0006(01)' },
            stage: { value: 'council' },
            institution: { value: 'Council of the European Union' },
            date: { value: '2016-04-08' },
            documentTitle: { value: 'Council position' },
          },
        ],
      },
    };
  });

  assert.match(query, /resource_legal_adopts_resource_legal/);
  assert.match(query, /\?documentWork cdm:resource_legal_contains_ep_opinion_on_resource_legal \?proposalWork/);
  assert.match(query, /\?documentWork cdm:resource_legal_influences_resource_legal \?proposalWork/);
  assert.match(query, /authority\/corporate-body\/CONSIL/);
  assert.match(query, /\?expression cdm:expression_belongs_to_work \?documentWork/);
  assert.match(query, /authority\/language\/ENG/);
  assert.doesNotMatch(query, /work_cites_work/);
  assert.equal(payload.reference, '2012/0011(COD)');
  assert.equal(payload.procedureUrl, 'https://eur-lex.europa.eu/procedure/EN/2012_11');
  assert.deepEqual(payload.documents.map(({ celex, stage, institution, date, title }) => ({
    celex, stage, institution, date, title,
  })), [
    {
      celex: '52012PC0011',
      stage: 'proposal',
      institution: 'European Commission',
      date: '2012-03-09',
      title: 'Commission proposal',
    },
    {
      celex: '52014AP0212',
      stage: 'ep',
      institution: 'European Parliament',
      date: '2014-04-15',
      title: 'Parliament position',
    },
    {
      celex: '52016AG0006(01)',
      stage: 'council',
      institution: 'Council of the European Union',
      date: '2016-04-08',
      title: 'Council position',
    },
    {
      celex: '32016R0679',
      stage: 'final',
      institution: 'European Parliament and Council',
      date: '2016-05-04',
      title: '32016R0679',
    },
  ]);
  assert.equal(new Set(payload.documents.map((document) => document.celex)).size, 4);
  assert.ok(payload.documents.every((document) => document.url.includes(`CELEX:${document.celex}`)));
});

test('fetchLegislativeProcedure returns confirmed absence without procedure documents', async () => {
  const payload = await fetchLegislativeProcedure('32000L0031', async () => ({
    results: { bindings: [] },
  }));

  assert.deepEqual(payload, {
    celex: '32000L0031',
    reference: null,
    procedureUrl: null,
    documents: [],
  });
});
