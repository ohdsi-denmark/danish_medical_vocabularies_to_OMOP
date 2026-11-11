import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { procedureProposal, procedureRelationships, proposal } from "./public/proposal.mjs";
import * as bulk from "./public/bulk.mjs";
import worker from "./worker.mjs";
import { expandProcedures } from "./public/procedure_data.mjs";

const readData = name => JSON.parse(readFileSync(new URL(`dist/${name}`, import.meta.url), "utf8"));
const drugs = readData("drugs.json");
const submissionData = readData("drug-proposals.json");
const labs = readData("data.json");
const procedureWire = readData("procedures.json");
const procedureIndex = expandProcedures(procedureWire);
const procedures = readData(procedureIndex.exportFile);
const conditionWire = readData("conditions.json");
const conditionIndex = expandProcedures(conditionWire);
const conditions = readData(conditionIndex.exportFile);
const positive = value => /^[1-9]\d*$/.test(value);
const suggestion = item => ({ item: item.id, code: item.code, target: "123456", reason: "Proposed target requires clinical review." });
const input = rows => ({ dataset: "drugs", commit: drugs.commit, rows });

test("backlogs exclude positive published mappings and preserve source identities", () => {
  const mapped = new Set(drugs.mappings.filter(row => row.reviewState === "Published" && positive(row.conceptId)).map(row => row.sourceKey));
  for (const item of drugs.unmapped) {
    assert(!mapped.has(item.sourceKey));
    assert.equal(drugs.sources[item.sourceKey].code, item.code);
  }
  assert(drugs.unmapped.some(item => item.category === "products"));
  assert(drugs.unmapped.some(item => item.category === "ingredients"));
  assert(drugs.unmapped.some(item => item.category === "routes"));
  assert(drugs.unmapped.some(item => item.category === "vaccines"));
  assert.equal(new Set(drugs.mappings.map(row => row.id)).size, drugs.mappings.length);
});

test("corrected product mappings are reviewable and absent from the unmapped export", () => {
  for (const catalog of [drugs, submissionData]) {
    const index = bulk.bulkIndex(catalog, "products");
    for (const [code, target] of [["Drug 177931", "40233964"], ["Drug 58888", "1539411"]]) {
      assert(!catalog.unmapped.some(item => item.code === code));
      assert.equal(index.get(code)?.length, 1);
      assert.equal(index.get(code)[0].conceptId, target);
    }
  }
  let ingredientOnly = 0;
  for (const item of drugs.unmapped.filter(item => item.category === "products")) {
    const source = drugs.sources[item.sourceKey];
    const details = source.detailIds.map(id => drugs.referenceRecords[id]);
    if (details.some(row => row["Historical target scope"] === "Ingredient only" && positive(row["Historical target concept ID"]))) {
      assert.match(source.backlogReason, /ingredient targets only/);
      ingredientOnly++;
    }
  }
  assert(ingredientOnly > 0);
});

test("different vaccine preparations sharing a code can be reviewed together", () => {
  const vaccines = drugs.mappings.filter(item => item.category === "vaccines");
  const first = vaccines[0];
  const second = vaccines.find(item => item.sourceCode === first.sourceCode && item.sourceKey !== first.sourceKey);
  assert(second);
  const pair = [first, second];
  const rows = pair.map(current => ({ ...suggestion(drugs.sources[current.sourceKey]), mapping: current.id }));
  const result = proposal(drugs, input(rows));
  assert(result.body.includes(first.sourceKey));
  assert(result.body.includes(second.sourceKey));
  assert.deepEqual(proposal(submissionData, input(rows)), result);
  assert.throws(() => proposal(drugs, input([rows[0], rows[0]])), /only once/);
});

test("corrections carry the original file and record and reject tampered identities", () => {
  const current = drugs.mappings.find(row => row.category === "products" && positive(row.conceptId));
  const row = { ...suggestion(drugs.sources[current.sourceKey]), mapping: current.id };
  const result = proposal(drugs, input([row]));
  assert(result.body.includes(current.sourceFile));
  assert(result.body.includes(`data record ${current.sourceRow}`));
  assert.deepEqual(proposal(submissionData, input([row])), result);
  assert.throws(() => proposal(drugs, input([{ ...row, item: "wrong-source" }])), /could not be found/);
  assert.throws(() => proposal(drugs, { ...input([row]), commit: "old-snapshot" }), /updated/);
  assert.throws(() => proposal(drugs, input([{ ...row, target: current.conceptId }])), /different/);
});

test("additional vaccine proposals remain separate and can be endorsed with justification", () => {
  const current = drugs.mappings.find(row => row.reviewState === "Needs review");
  assert(current.sourceFile.includes("additional_mapping_proposals"));
  const row = { ...suggestion(drugs.sources[current.sourceKey]), mapping: current.id, target: current.conceptId };
  assert(proposal(drugs, input([row])).body.includes("Existing proposal"));
});

test("legacy Measurements proposals still work", () => {
  const current = labs.mappings[0];
  const result = proposal(labs, { commit: labs.commit, rows: [{ code: current.sourceCode, mapping: current.id,
    target: "123456", reason: "Alternative mapping needs review." }] });
  assert(result.body.includes(current.conceptId));
});

test("bulk files support four delimiters, quotes and rows without headers", () => {
  for (const delimiter of [",", ";", "\t", " "]) {
    const file = `\uFEFF"Danish; code"${delimiter}target\r\n"Drug 00123"${delimiter}123456\r\n`;
    assert.equal(bulk.detectDelimiter(file), delimiter);
    assert.deepEqual(bulk.parseBulkText(file, delimiter), [["Danish; code", "target"], ["Drug 00123", "123456"]]);
  }
  assert.deepEqual(bulk.parseBulkText(' "Drug 00123"   123456  ', " "), [["Drug 00123", "123456"]]);
  assert.deepEqual(bulk.parseBulkText('code;target\n"A;B";123456', ";")[1], ["A;B", "123456"]);
  assert.throws(() => bulk.parseBulkText('code,target\n"unfinished,123456', ","), /unclosed/);
  assert.throws(() => bulk.parseBulkText("code\0,target", ","), /plain-text/);
});

test("bulk proposals require exact published records and generate a normalized CSV", () => {
  const index = bulk.bulkIndex(drugs, "vaccines");
  const [code, candidates] = [...index].find(([, records]) => records.length > 1);
  const row = { code, target: "123456" };
  const payload = input(undefined);
  payload.bulk = { category: "vaccines", rows: [row], reason: "Review the proposed vaccine target." };
  assert.throws(() => bulk.bulkProposal(drugs, payload), /choose a mapping or unmapped source record/);
  row.mapping = candidates[0].id;
  const result = bulk.bulkProposal(drugs, payload);
  assert.deepEqual(bulk.bulkProposal(submissionData, payload), result);
  assert(result.csv.includes('"proposed_omop_concept_id"'));
  assert(result.csv.includes(`"${candidates[0].id}"`));
  payload.bulk.rows.push(row);
  assert.throws(() => bulk.bulkProposal(drugs, payload), /listed more than once/);
});

test("every unmapped template fits the upload limit and round-trips its source identities", () => {
  for (const [catalog, server, category] of [[labs, labs, "npu"],
    [procedures, procedures, "procedures"],
    [conditions, conditionIndex, "conditions"],
    ...Object.keys(drugs.categories).map(category => [drugs, submissionData, category])]) {
    const items = catalog.unmapped.filter(item => (item.category || "npu") === category);
    const csv = bulk.unmappedCsv(catalog, items);
    assert(new TextEncoder().encode(csv).length <= bulk.bulkFileLimit);
    assert.equal(bulk.detectDelimiter(csv), ";");
    const [columns, ...rows] = bulk.parseBulkText(csv, ";");
    assert.equal(columns.at(-1), "OMOP_concept_id");
    assert.equal(rows.length, items.length);
    const index = bulk.bulkIndex(server, category);
    for (const [code, id, ...details] of rows) {
      assert.equal(details.at(-1), "");
      assert(index.get(code)?.some(record => record.unmapped && record.id === id), `${category}: ${code}`);
    }
    const [[code, mapping]] = rows;
    const payload = { commit: catalog.commit, bulk: { category, rows: [{ code, mapping, target: "123456" }],
      reason: "Suggest a target for this unmapped record." } };
    const proposal = bulk.bulkProposal(server, payload);
    assert(proposal.body.includes("New mappings: 1"));
    assert(proposal.csv.includes('"123456"'));
    assert.equal(proposal.records[0].current.conceptId, undefined);
  }
});

test("procedure backlog includes current operations and all observed procedure codes without a target", () => {
  const release = JSON.parse(readFileSync(new URL("../Procedures/sks_operations.json", import.meta.url), "utf8"));
  const counts = bulk.parseBulkText(readFileSync(new URL("../Procedures/procedure_source_code_counts.csv", import.meta.url), "utf8"), ";").slice(1);
  const mapped = new Set(procedures.mappings.filter(row => positive(row.conceptId)).map(row => row.sourceCode));
  const expected = [...new Set([...release.operations.filter(row => row.active && row.reportable).map(row => row.code),
    ...counts.map(row => row[0])])].filter(code => !mapped.has(code)).sort();
  assert.deepEqual(procedures.unmapped.map(row => row.code), expected);
  assert(expected.length > 0);
  assert(!expected.includes("K"));
  for (const [code, frequency] of counts) assert.equal(procedures.sources[code].occurrences, frequency);
  const suppressed = procedures.unmapped.find(row => row.occurrences?.startsWith("<"));
  const missing = procedures.unmapped.find(row => row.occurrences == null);
  const observed = procedures.unmapped.find(row => !procedures.sources[row.code].currentOperation);
  assert(suppressed && missing && observed);
  const csv = bulk.parseBulkText(bulk.unmappedCsv(procedures, [suppressed, missing, observed]), ";");
  const frequencyColumn = csv[0].indexOf("source_frequency");
  assert.equal(csv[1][frequencyColumn], suppressed.occurrences);
  assert.equal(csv[2][frequencyColumn], "");
  assert(csv[0].some(column => column.startsWith("Source rows · ")));
  assert.equal(csv[0].at(-1), "OMOP_concept_id");
});

test("procedure proposals preserve source groups and identify edited records", () => {
  const code = "KTNB0H";
  const [site, procedure] = procedures.mappings.filter(row => row.sourceCode === code);
  assert.equal(site.domainId, "Spec Anatomic Site");
  assert.equal(procedure.domainId, "Procedure");
  const payload = { dataset: "procedures", commit: procedures.commit, procedure: {
    code, reason: "Clarify the intended procedure and anatomy.", relationship: "components", changes: [
      { action: "remove", mapping: site.id }, { action: "replace", mapping: procedure.id, target: "123456" },
      { action: "add", target: "654321" },
    ],
  } };
  const issue = procedureProposal(procedures, payload);
  assert(issue.body.includes(`Remove record ${site.sourceRow}`));
  assert(issue.body.includes(`Replace record ${procedure.sourceRow}`));
  assert(issue.body.includes("Complementary components"));
  assert(issue.body.includes("Entire ankle and foot"));
  assert.throws(() => procedureProposal(procedures, { ...payload, procedure: {
    ...payload.procedure, changes: [{ action: "add", target: site.conceptId }],
  } }), /already in the proposed target set/);
  assert.throws(() => procedureProposal(procedures, { ...payload, procedure: {
    ...payload.procedure, code: procedures.unmapped[0].code,
  } }), /distinct mapping record/);
});

test("compact procedure index and on-demand details preserve catalogue and submission identities", () => {
  assert(!procedureWire.sources);
  const details = new Map();
  for (const source of Object.values(procedureIndex.sources)) {
    assert(!source.details);
    if (!details.has(source.detailFile)) details.set(source.detailFile, readData(source.detailFile));
    const chunk = details.get(source.detailFile);
    assert.equal(chunk.commit, procedures.commit);
    assert.deepEqual(chunk.sources[source.code], procedures.sources[source.code]);
    assert.equal(source.name, procedures.sources[source.code].name);
  }
  assert.equal(Object.keys(procedureIndex.sources).length, Object.keys(procedures.sources).length);
  assert.equal(procedures.sources.ZZ3160.name, "Blodtryksmåling");
  assert.equal(procedures.sources.BVAA33A.name, "Telefonkonsultation");
  assert.equal(procedures.sources.KZYQ00.details[0].Classification, "Supplementary");
  assert.equal(procedures.sources.KTNB0H.details[0]["Terminology status"], "Historical / inactive");
  const item = procedures.unmapped[0];
  const input = { dataset: "procedures", commit: procedures.commit, procedure: { code: item.code,
    reason: "Suggest a target for this procedure.", relationship: "unspecified", changes: [{ action: "add", target: "123456" }] } };
  assert.deepEqual(procedureProposal(procedureIndex, input), procedureProposal(procedures, input));
  const bulkInput = { dataset: "procedures", commit: procedures.commit, bulk: { category: "procedures",
    rows: [{ code: item.code, mapping: item.id, target: "123456" }], reason: "Suggest a target for this procedure." } };
  assert.deepEqual(bulk.bulkProposal(procedureIndex, bulkInput), bulk.bulkProposal(procedures, bulkInput));
});

test("conditions preserve every custom row and separate standard references from coverage gaps", () => {
  const original = bulk.parseBulkText(readFileSync(new URL("../Conditions/stcm_dacICD10.csv", import.meta.url), "utf8"), ",").slice(1);
  assert.equal(conditions.mappings.length, original.length);
  assert.equal(new Set(conditions.mappings.map(row => row.sourceCode)).size, 454);
  for (const [index, row] of original.entries()) {
    assert.equal(conditions.mappings[index].sourceCode, row[0]);
    assert.equal(conditions.mappings[index].conceptId, row[4]);
    assert.equal(conditions.mappings[index].target_vocabulary_id, row[5]);
  }
  assert.equal(conditions.sources["C20.9M"].details[0]["SKS lookup code"], "DC209M");
  const custom = new Set(conditions.mappings.map(row => row.sourceCode));
  const standard = new Set(conditions.referenceCodes);
  assert(conditions.unmapped.every(row => !custom.has(row.code)));
  assert.deepEqual(conditions.uncovered, conditions.unmapped.filter(row => !standard.has(row.code)).map(row => row.code));
  assert(conditions.unmapped.some(row => standard.has(row.code)));
  assert.equal(conditions.sources["999"].occurrences, null);
  assert.equal(conditions.sources["999"].details[0]["Observed source code counts"], "999: <5, <5");
  const rows = conditions.mappings.filter(row => row.sourceCode === "S91.8");
  assert(rows.length > 1);
  const payload = { dataset: "conditions", commit: conditions.commit, condition: { code: "S91.8", relationship: "unspecified",
    reason: "Review a replacement while retaining the other targets.", changes: [{ action: "replace", mapping: rows[0].id, target: "123456" }] } };
  const issue = procedureProposal(conditionIndex, payload);
  assert(issue.title.includes("Condition mapping proposal"));
  assert(issue.body.includes(rows[1].conceptId));
  assert(issue.body.includes("supplied standard mapping reference"));
  assert.throws(() => procedureProposal(conditionIndex, { ...payload, condition: { ...payload.condition,
    changes: [{ action: "remove", mapping: "sks-1" }] } }), /distinct mapping record/);
});

test("submission endpoint validates identities, prevents duplicate issues and serves confirmed bulk files", async () => {
  const originalFetch = globalThis.fetch;
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("migrations/0001_submissions.sql", import.meta.url), "utf8"));
  database.exec(readFileSync(new URL("migrations/0002_bulk_files.sql", import.meta.url), "utf8"));
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
  let issues = 0;
  let rateAllowed = true;
  let assetPath;
  let attachment;
  const repository = "example/test-mappings";
  const env = {
    TURNSTILE_SITE_KEY: "test", TURNSTILE_SECRET: "test", GITHUB_APP_CLIENT_ID: "test",
    GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_INSTALLATION_ID: "1", GITHUB_REPOSITORY: repository,
    PROPOSAL_RATE: { limit: async () => ({ success: rateAllowed }) },
    ASSETS: { fetch: async url => { assetPath = url.pathname;
      return Response.json(assetPath === "/conditions.json" ? conditionWire : assetPath === "/procedures.json" ? procedureWire : submissionData);
    } },
    SUBMISSIONS: { prepare: query => ({ bind: (...args) => ({
      first: async () => database.prepare(query).get(...args),
      run: async () => ({ meta: database.prepare(query).run(...args) }),
    }) }) },
  };
  globalThis.fetch = async (url, options) => {
    if (url.includes("siteverify")) return Response.json({ success: true, action: "mapping_proposal", hostname: "local.test" });
    if (url.includes("access_tokens")) return Response.json({ token: "test" });
    issues++;
    const issue = JSON.parse(options.body);
    const download = issue.body.match(/https:\/\/local\.test\/api\/bulk-files\/[A-Za-z0-9_-]{43}\.csv/);
    if (download) {
      attachment = download[0];
      assert.equal((await worker.fetch(new Request(attachment), env)).status, 404);
      assert.deepEqual(Object.keys(issue).sort(), ["body", "title"]);
    }
    return Response.json({ html_url: `https://github.com/${repository}/issues/${issues}` }, { status: 201 });
  };
  const send = payload => worker.fetch(new Request("https://local.test/api/proposals", {
    method: "POST", headers: { Origin: "https://local.test" }, body: JSON.stringify({ ...payload, token: "test" }),
  }), env);
  try {
    const payload = input([suggestion(drugs.unmapped.find(item => item.category === "products"))]);
    const attempts = await Promise.all([send(payload), send(payload)]);
    assert(attempts.some(response => response.status === 201));
    assert(attempts.every(response => [200, 201, 409].includes(response.status)));
    assert.equal(assetPath, "/drug-proposals.json");
    assert.equal(issues, 1);
    assert.equal((await send(payload)).status, 200);
    assert.equal((await send({ ...payload, dataset: "unexpected" })).status, 400);
    assert.equal((await send(input([{ ...payload.rows[0], item: "tampered" }]))).status, 400);
    const current = drugs.mappings.find(row => row.category === "products" && positive(row.conceptId));
    const upload = { dataset: "drugs", commit: drugs.commit, bulk: { category: "products",
      reason: "Review this product mapping in bulk.", rows: [{ code: current.sourceCode, mapping: current.id, target: "123456" }] } };
    assert.equal((await send(upload)).status, 201);
    assert.equal((await send(upload)).status, 200);
    const file = await worker.fetch(new Request(attachment), env);
    assert.match(file.headers.get("Content-Disposition"), /attachment/);
    assert.equal(await file.text(), bulk.bulkProposal(drugs, upload).csv);
    const procedureInput = { dataset: "procedures", commit: procedures.commit, procedure: {
      code: procedures.unmapped[0].code, reason: "Propose the first mapping for this procedure.", relationship: "unspecified",
      changes: [{ action: "add", target: "123456" }, { action: "add", target: "654321" }],
    } };
    assert.equal((await send(procedureInput)).status, 201);
    assert.equal(assetPath, "/procedures.json");
    assert.equal((await send(procedureInput)).status, 200);
    const conditionInput = { dataset: "conditions", commit: conditions.commit, condition: {
      code: conditions.uncovered[0], reason: "Propose a custom mapping for this diagnosis.", relationship: "unspecified",
      changes: [{ action: "add", target: "123456" }],
    } };
    assert.equal((await send(conditionInput)).status, 201);
    assert.equal(assetPath, "/conditions.json");
    assert.equal((await send(conditionInput)).status, 200);
    const conditionBulk = { dataset: "conditions", commit: conditions.commit, bulk: { category: "conditions",
      reason: "Propose a custom target using the condition template.", rows: [{ code: conditions.uncovered[1], mapping: conditions.uncovered[1], target: "123456" }] } };
    assert.equal((await send(conditionBulk)).status, 201);
    assert((await (await worker.fetch(new Request(attachment), env)).text()).includes("standard_reference_target_ids"));
    rateAllowed = false;
    assert.equal((await send(payload)).status, 429);
    assert.equal(issues, 5);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.events[key] = callback; }
  click() { this.events.click?.({ currentTarget: this }); }
}
const text = element => typeof element === "string" ? element :
  [element.textContent || "", ...element.children.map(text)].join(" ");
const descendants = element => [element, ...element.children.filter(child => typeof child !== "string").flatMap(descendants)];

test("navigation, search, detail views and proposal preview use the selected collection", async () => {
  const view = new Element("main");
  const requested = [];
  let failFile;
  const downloads = [];
  const context = vm.createContext({
    document: { querySelector: selector => selector === "#view" ? view : new Element("div"), createElement: tag => new Element(tag) },
    location: { hash: "#drugs/products/review" }, snapshot: drugs, labs, proposal, batchLimit: 10,
    fetch: async file => {
      requested.push(file);
      if (file === failFile) return new Response("Temporarily unavailable", { status: 503 });
      return Response.json(file === "conditions.json" ? conditionWire : file === "procedures.json" ? procedureWire : /^(procedure|condition)-details\//.test(file) ? readData(file) : drugs);
    },
    expandProcedures,
    Blob, URL: { createObjectURL: blob => { downloads.push(blob); return "blob:download"; }, revokeObjectURL() {} },
    setTimeout: callback => callback(),
    ...bulk, procedureProposal, procedureRelationships, TextDecoder, TextEncoder,
  });
  const source = readFileSync(new URL("public/app.mjs", import.meta.url), "utf8");
  vm.runInContext(source.slice(source.indexOf('const view ='), source.lastIndexOf('\ntry {')) +
    '\ndata = labs; drugData = snapshot;', context);
  await vm.runInContext("render()", context);
  assert(text(view).includes("Medication products · Review mappings"));
  context.location.hash = "#drugs/ingredients/review";
  await vm.runInContext("render()", context);
  assert(text(view).includes("Medication ingredients · Review mappings"));
  context.location.hash = "#drugs/vaccines/review";
  await vm.runInContext("render()", context);
  assert(text(view).includes("Vaccines · Review mappings"));
  context.location.hash = "#drugs/routes/review";
  await vm.runInContext("render()", context);
  const mappedRoutes = drugs.mappings.filter(row => row.category === "routes" && positive(row.conceptId));
  assert(text(view).includes(`${mappedRoutes.length} results`));
  assert(!text(view).includes("No usable target recorded"));
  assert(!text(view).includes("Indgiftandreveje"));
  context.location.hash = "#drugs/routes/unmapped";
  await vm.runInContext("render()", context);
  assert(text(view).includes("Indgiftandreveje"));
  const checkbox = descendants(view).find(element => element.attributes.type === "checkbox");
  checkbox.checked = true;
  checkbox.events.change();
  context.location.hash = "#drug-propose";
  await vm.runInContext("render()", context);
  const form = descendants(view).find(element => element.tag === "form");
  const target = descendants(form).find(element => element.attributes.inputmode === "numeric");
  const reason = descendants(form).find(element => element.tag === "textarea");
  target.value = "123456";
  reason.value = "A route target for maintainer review.";
  form.events.submit({ preventDefault() {} });
  assert(text(view).includes("Category: Administration routes"));
  assert(!text(view).includes("published NPU report"));
  const vaccine = drugs.mappings.find(row => row.category === "vaccines");
  context.location.hash = `#drug-mapping/${drugs.commit}/${vaccine.id}`;
  await vm.runInContext("render()", context);
  assert(text(view).includes("Danish source"));
  assert(text(view).includes("OMOP target"));
  context.location.hash = "#downloads";
  await vm.runInContext("render()", context);
  assert(text(view).includes("Measurements"));
  assert(text(view).includes("Medication mappings"));
  context.location.hash = "#unmapped";
  await vm.runInContext("render()", context);
  assert(text(view).includes("Unmapped NPU codes"));
  assert(text(view).includes("Download unmapped codes (CSV)"));
  for (const type of ["products", "ingredients", "vaccines", "routes"]) {
    context.location.hash = `#drugs/${type}/bulk`;
    await vm.runInContext("render()", context);
    assert(text(view).includes(`${bulk.bulkTypes[type]} · Upload bulk changes`));
  }
  context.location.hash = "#bulk/dnk";
  await vm.runInContext("render()", context);
  assert(text(view).includes("DNK measurements · Upload bulk changes"));
  context.location.hash = "#bulk/npu";
  await vm.runInContext("render()", context);
  const [code] = [...bulk.bulkIndex(labs, "npu")].find(([, records]) => records.length === 1);
  const upload = descendants(view).find(element => element.attributes.type === "file");
  upload.files = [new Blob([`source_code;proposed_omop_concept_id\n${code};123456\n`])];
  await upload.events.change();
  descendants(view).find(element => element.tag === "button" && text(element).includes("Validate rows")).events.click();
  descendants(view).find(element => element.tag === "textarea").value = "Review the proposed lab mapping.";
  descendants(view).find(element => element.tag === "form").events.submit({ preventDefault() {} });
  assert(text(view).includes("Bulk mapping proposal for NPU measurements (1 change)"));
  const template = bulk.parseBulkText(bulk.unmappedCsv(labs, labs.unmapped.slice(0, 3)), ";");
  template[1][template[0].length - 1] = "123456";
  upload.files = [new Blob([template.map(row => row.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(";")).join("\n")])];
  await upload.events.change();
  descendants(view).find(element => element.tag === "button" && text(element).includes("Validate rows")).events.click();
  descendants(view).find(element => element.tag === "form").events.submit({ preventDefault() {} });
  assert(text(view).includes("New mappings: 1"));
  context.location.hash = "#procedures/review";
  await vm.runInContext("render()", context);
  const sourceCount = new Set(procedures.mappings.map(row => row.sourceCode)).size;
  assert(text(view).includes(`${sourceCount.toLocaleString()} results`));
  assert.deepEqual(requested, ["drugs.json", "procedures.json", "conditions.json"]);
  context.location.hash = `#procedure/${procedures.commit}/KTNB0H`;
  await vm.runInContext("render()", context);
  assert(text(view).includes("Entire ankle and foot"));
  assert(text(view).includes("Application of bandage"));
  assert(text(view).includes("Relationship between targets unspecified"));
  assert.equal(requested.filter(file => file.startsWith("procedure-details/")).length, 1);
  context.location.hash = "#procedures/unmapped";
  await vm.runInContext("render()", context);
  assert(text(view).includes("Unmapped procedure codes"));
  assert(text(view).includes("Download unmapped codes (CSV)"));
  assert.equal(requested.filter(file => file.startsWith("procedure-details/")).length, 1);
  const rank = item => item.occurrences == null ? -2 : item.occurrences.startsWith("<") ? -1 : Number(item.occurrences);
  const ranked = [...procedures.unmapped].sort((a, b) => rank(b) - rank(a) || a.code.localeCompare(b.code));
  let procedureLinks = descendants(view).filter(element => element.tag === "a" && element.attributes.href?.startsWith("#procedure/"));
  assert(procedureLinks[0].attributes.href.endsWith(`/${ranked[0].code}`));
  const scope = descendants(view).find(element => element.tag === "label" && text(element).trim().startsWith("Code scope"));
  descendants(scope).find(element => element.tag === "select").events.change({ target: { value: "Current SKS operations" } });
  procedureLinks = descendants(view).filter(element => element.tag === "a" && element.attributes.href?.startsWith("#procedure/"));
  assert(procedureLinks.length > 0);
  for (const item of procedureLinks) assert(procedures.sources[item.attributes.href.split("/").at(-1)].currentOperation);
  const sorter = descendants(view).find(element => element.tag === "label" && text(element).trim().startsWith("Sort by"));
  descendants(sorter).find(element => element.tag === "select").events.change({ target: { value: "Code" } });
  procedureLinks = descendants(view).filter(element => element.tag === "a" && element.attributes.href?.startsWith("#procedure/"));
  const alphabetical = procedures.unmapped.filter(item => procedures.sources[item.code].currentOperation).sort((a, b) => a.code.localeCompare(b.code));
  assert(procedureLinks[0].attributes.href.endsWith(`/${alphabetical[0].code}`));
  context.location.hash = `#procedure-propose/${procedures.commit}/${procedures.unmapped[0].code}`;
  await vm.runInContext("render()", context);
  descendants(view).find(element => element.attributes.inputmode === "numeric").value = "123456";
  descendants(view).find(element => element.tag === "textarea").value = "Suggest the first target for this operation.";
  descendants(view).find(element => element.tag === "form").events.submit({ preventDefault() {} });
  assert(text(view).includes("No current mapping records"));
  assert(text(view).includes("Add [123456]"));
  const requestedFiles = new Set(requested);
  const retrySource = Object.values(procedureIndex.sources).find(source => !requestedFiles.has(source.detailFile));
  context.location.hash = `#procedure/${procedures.commit}/${retrySource.code}`;
  failFile = retrySource.detailFile;
  await vm.runInContext("render()", context);
  assert(vm.runInContext("loadStatus.textContent", context).includes("Mappings could not be loaded"));
  failFile = undefined;
  await vm.runInContext("render()", context);
  assert(text(view).includes(retrySource.name));
  assert.equal(requested.filter(file => file === retrySource.detailFile).length, 2);
  await vm.runInContext("render()", context);
  assert.equal(requested.filter(file => file === retrySource.detailFile).length, 2);
  context.location.hash = "#procedures/unmapped";
  await vm.runInContext("render()", context);
  const download = descendants(view).find(element => element.tag === "button" && text(element).includes("Download unmapped codes"));
  failFile = procedureIndex.exportFile;
  await download.events.click();
  assert.equal(download.disabled, false);
  assert(download.textContent.includes("retry"));
  assert.equal(downloads.length, 0);
  failFile = undefined;
  await download.events.click();
  assert.equal(downloads.length, 1);
  const csv = bulk.parseBulkText(await downloads[0].text(), ";");
  assert.equal(csv.length, procedures.unmapped.length + 1);
  assert(csv[0].includes("Official terminology label"));
  assert(csv[0].includes("Terminology file"));
  assert.equal(csv[0].at(-1), "OMOP_concept_id");
  assert.equal(requested.filter(file => file === procedureIndex.exportFile).length, 2);
  await download.events.click();
  assert.equal(downloads.length, 2);
  assert.equal(requested.filter(file => file === procedureIndex.exportFile).length, 2);
  context.location.hash = "#conditions/review";
  await vm.runInContext("render()", context);
  assert(text(view).includes("Review condition mappings"));
  assert(text(view).includes("454 results"));
  context.location.hash = `#condition/${conditions.commit}/S91.8`;
  await vm.runInContext("render()", context);
  assert(text(view).includes("4129408"));
  assert(text(view).includes("4054067"));
  assert(text(view).includes("Supplied standard reference targets"));
  assert(text(view).includes("Mapping valid from"));
  context.location.hash = "#conditions/unmapped";
  await vm.runInContext("render()", context);
  assert(text(view).includes(`${conditions.uncovered.length.toLocaleString()} results`));
  const listed = descendants(view).filter(element => element.tag === "a" && element.attributes.href?.startsWith("#condition/"));
  assert(listed.length > 0);
  for (const item of listed) assert(conditions.uncovered.includes(item.attributes.href.split("/").at(-1)));
  const conditionDownload = descendants(view).find(element => element.tag === "button" && text(element).includes("Download listed coverage"));
  await conditionDownload.events.click();
  const conditionCsv = bulk.parseBulkText(await downloads.at(-1).text(), ";");
  assert.equal(conditionCsv.length, conditions.uncovered.length + 1);
  assert(conditionCsv[0].includes("Standard mapping coverage"));
  assert(conditionCsv.every((row, index) => index === 0 || conditions.uncovered.includes(row[0])));
  context.location.hash = `#condition-propose/${conditions.commit}/${conditions.uncovered[0]}`;
  await vm.runInContext("render()", context);
  descendants(view).find(element => element.attributes.inputmode === "numeric").value = "123456";
  descendants(view).find(element => element.tag === "textarea").value = "Suggest a custom target for this diagnosis.";
  descendants(view).find(element => element.tag === "form").events.submit({ preventDefault() {} });
  assert(text(view).includes("Condition mapping proposal"));
  assert(text(view).includes("supplied standard mapping reference"));
});
