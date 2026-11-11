import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import * as bulk from "./public/bulk.mjs";
import { procedureProposal, procedureRelationships, proposal, batchLimit } from "./public/proposal.mjs";
import { careDetailFile, careFlagLabels, careKey, careSubmissionData, careSummary } from "./public/care_data.mjs";
import { createCarePages } from "./public/care_ui.mjs";
import { expandProcedures } from "./public/procedure_data.mjs";

const read = file => JSON.parse(readFileSync(new URL(`dist/${file}`, import.meta.url), "utf8"));
const manifest = read("caresites.json");
const indexes = Object.fromEntries(Object.entries(manifest.indexes).map(([category, path]) => [category, read(path).rows]));
const samples = [0, 1, 2].map(method => indexes.sor.find(row => row[2] === method && row[3].length));
const unresolved = read(manifest.unmappedFile);
const load = async path => read(path);
const singleInput = (row, category = "sor", action = "replace") => ({ dataset: "caresites", commit: manifest.commit,
  caresite: { code: careKey(category, row[0]), changes: [{ action, mapping: `${category}-row-${row[3][0]?.[0]}`, target: "123456" }],
    relationship: "unspecified", reason: "Review the care-site classification and proposed target." } });

test("care-site indexes preserve coding systems, provenance, and unresolved SOR membership", () => {
  const actual = Object.fromEntries(manifest.methods.slice(0, 3).map((method, index) => [method, indexes.sor.filter(row => row[2] === index).length]));
  assert.deepEqual(actual, { Manual: 81, "Rule-based": 37028, LLM: 122504 });
  assert.equal(indexes.sor.length, 159613);
  assert.equal(indexes.legacy.length, 4092);
  assert.equal(indexes.visittypes.reduce((sum, row) => sum + row[3].length, 0), 160);
  const missing = indexes.sor.filter(row => !row[3].length);
  assert.equal(missing.length, 1026);
  assert.deepEqual(new Set(unresolved.unmapped.map(row => row.code)), new Set(missing.map(row => row[0])));
  const mapped = new Set(indexes.sor.filter(row => row[3].length).map(row => row[0]));
  assert(unresolved.unmapped.every(row => !mapped.has(row.code)));
  for (const category of Object.keys(indexes)) for (const row of indexes[category].slice(0, 12)) {
    const key = careKey(category, row[0]);
    const group = read(careDetailFile(manifest, key));
    const source = group.sources[key];
    assert.equal(source.code, row[0]);
    assert.equal(source.category, category);
    const summary = careSummary(manifest, category, [row]);
    const full = group.mappings.filter(record => record.sourceKey === key);
    assert.deepEqual(summary.mappings.map(record => record.id), full.map(record => record.id));
    assert.deepEqual(summary.mappings.map(record => record.conceptId), full.map(record => record.conceptId));
  }
  const scientific = indexes.legacy.find(row => /E\+/.test(row[0]));
  assert(scientific);
  assert(careFlagLabels(manifest, scientific[4]).includes("Source code stored in scientific notation"));
});

test("care-site single and bulk proposals load bounded trusted records and retain their origins", async () => {
  for (const row of samples) {
    const payload = singleInput(row);
    const requested = [];
    const data = await careSubmissionData(manifest, payload, async path => { requested.push(path); return read(path); });
    assert.equal(requested.length, 1);
    assert.equal(Object.keys(data.sources).length, 1);
    const issue = procedureProposal(data, payload);
    assert(issue.title.includes("Care-site mapping proposal"));
    assert(issue.title.includes(row[0]));
    assert(issue.body.includes(`Recorded mapping origin: ${manifest.methods[row[2]]}`));
    if (row[2] === 2) assert(issue.body.includes("Recorded classification justification"));
    assert(issue.body.includes("SOR_to_visit_concept.csv"));
    assert.throws(() => procedureProposal(data, { ...payload, caresite: { ...payload.caresite,
      changes: [{ action: "remove", mapping: "legacy-row-1" }] } }), /distinct mapping record/);
  }
  const row = indexes.sor.find(row => !row[3].length);
  const payload = singleInput(row, "sor", "add");
  const data = await careSubmissionData(manifest, payload, load);
  const issue = procedureProposal(data, payload);
  assert(issue.body.includes("No current mapping records"));
  assert(issue.body.includes("Classification record"));
  const upload = { dataset: "caresites", commit: manifest.commit, bulk: { category: "sor", reason: "Review these classifications together.",
    rows: [{ code: samples[2][0], mapping: `sor-row-${samples[2][3][0][0]}`, target: "123456" },
      { code: row[0], mapping: careKey("sor", row[0]), target: "123456" }] } };
  const requested = [];
  const subset = await careSubmissionData(manifest, upload, async path => { requested.push(path); return read(path); });
  assert(requested.length <= 2);
  assert(requested.every(path => path.startsWith(`${manifest.assetRoot}/validation/sor/`)));
  assert.equal(Object.keys(subset.sources).length, 2);
  const prepared = bulk.bulkProposal(subset, upload);
  assert(prepared.csv.includes('"mapping_method"'));
  assert(prepared.csv.includes('"LLM"'));
  assert(prepared.body.includes("New mappings: 1"));
  await assert.rejects(careSubmissionData(manifest, { ...payload, commit: "old" }, load), /updated/);
  await assert.rejects(careSubmissionData(manifest, { ...payload, caresite: { ...payload.caresite, code: "sor-../../private" } }, async path => {
    assert.match(path, /^care-site-data\/[a-f0-9]+\/details\/[a-f0-9]{3}\.json$/);
    return read(path);
  }), /Unknown care site/);
  await assert.rejects(careSubmissionData(manifest, upload, async path => ({ ...read(path), commit: "other" })), /different snapshot/);
});

test("unresolved care-site templates contain only unresolved codes and round-trip bulk identities", () => {
  const csv = bulk.unmappedCsv(unresolved, unresolved.unmapped);
  assert(new TextEncoder().encode(csv).length < bulk.bulkFileLimit);
  const [headers, ...rows] = bulk.parseBulkText(csv, ";");
  assert.equal(rows.length, 1026);
  assert.equal(headers.at(-1), "OMOP_concept_id");
  assert(headers.includes("Classification justification"));
  assert(headers.includes("Mapping method"));
  const codes = new Set(rows.map(row => row[0]));
  const subset = careSummary(manifest, "sor", indexes.sor, codes);
  const index = bulk.bulkIndex(subset, "sor");
  for (const [code, id] of rows) assert(index.get(code).some(row => row.unmapped && row.id === id));
  const visits = read(manifest.unmappedFiles.visittypes);
  assert.equal(visits.unmapped.length, manifest.stats.visittypes.unresolved);
  assert.equal(visits.unmapped.length, 118);
  const visitIndex = bulk.bulkIndex(careSummary(manifest, "visittypes", indexes.visittypes), "visittypes");
  for (const item of visits.unmapped) assert(visitIndex.get(item.code).some(row => row.unmapped && row.id === item.id));
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.events[key] = callback; }
  click() { this.events.click?.({ currentTarget: this }); }
}
const text = element => typeof element === "string" ? element : [element.textContent || "", ...element.children.map(text)].join(" ");
const descendants = element => [element, ...element.children.filter(child => typeof child !== "string").flatMap(descendants)];
const field = (view, label) => descendants(descendants(view).find(element => element.tag === "label" && text(element).trim().startsWith(label))).find(element => element.tag === "select");

test("care-site pages filter origins, expose provenance, and load details and bulk candidates on demand", async () => {
  const view = new Element("main");
  const requested = [];
  const downloads = [];
  let failFile;
  const context = vm.createContext({
    document: { querySelector: selector => selector === "#view" ? view : new Element("div"), createElement: tag => new Element(tag) },
    location: { hash: "#caresites/sor/review" },
    fetch: async path => { requested.push(path); return path === failFile ? new Response("Unavailable", { status: 503 }) : Response.json(read(path)); },
    ...bulk, batchLimit, procedureProposal, procedureRelationships, proposal, createCarePages, expandProcedures, TextDecoder, TextEncoder, Blob,
    URL: { createObjectURL: blob => { downloads.push(blob); return "blob:download"; }, revokeObjectURL() {} }, setTimeout: callback => callback(),
  });
  const source = readFileSync(new URL("public/app.mjs", import.meta.url), "utf8");
  vm.runInContext(source.slice(source.indexOf("const view ="), source.lastIndexOf("\ntry {")), context);
  const render = async hash => { context.location.hash = hash; await vm.runInContext("render()", context); };
  await render("#caresites/sor/review");
  assert(text(view).includes("SOR organisations · Review mappings"));
  assert(text(view).includes(`${(158587).toLocaleString()} results`), text(view).slice(0, 1600));
  assert.deepEqual(requested, ["caresites.json", manifest.indexes.sor]);
  field(view, "Mapping method").events.change({ target: { value: "Manual" } });
  assert(text(view).includes("81 results"));
  const llm = samples[2];
  await render(`#care-site/${manifest.commit}/${careKey("sor", llm[0])}`);
  assert(text(view).includes("Recorded LLM justification"));
  assert(text(view).includes("Not human verified"));
  assert(text(view).includes("Recorded classification and downstream Visit mappings"));
  const detailFile = careDetailFile(manifest, careKey("sor", llm[0]));
  assert.equal(requested.filter(path => path === detailFile).length, 1);
  await render(`#care-site-propose/${manifest.commit}/${careKey("sor", llm[0])}`);
  assert.equal(requested.filter(path => path === detailFile).length, 1);
  await render("#caresites/sor/unmapped");
  assert(text(view).includes(`${(1026).toLocaleString()} results`));
  const missingLinks = descendants(view).filter(element => element.tag === "a" && element.attributes.href?.startsWith("#care-site/"));
  const missingIds = new Set(unresolved.unmapped.map(row => row.id));
  for (const anchor of missingLinks) assert(missingIds.has(decodeURIComponent(anchor.attributes.href.split("/").at(-1))));
  await descendants(view).find(element => element.tag === "button" && text(element).includes("Download unmapped codes")).events.click();
  assert.equal(bulk.parseBulkText(await downloads[0].text(), ";").length, 1027);
  const missing = unresolved.unmapped[0];
  await render(`#care-site-propose/${manifest.commit}/${missing.id}`);
  descendants(view).find(element => element.attributes.inputmode === "numeric").value = "123456";
  descendants(view).find(element => element.tag === "textarea").value = "Propose a resolved place-of-service target.";
  descendants(view).find(element => element.tag === "form").events.submit({ preventDefault() {} });
  assert(text(view).includes(`Care-site mapping proposal for ${missing.code}`));
  assert(text(view).includes("Classification record"));
  await render("#caresites/legacy/review");
  assert(text(view).includes("Legacy departments · Review mappings"));
  assert(text(view).includes("Usagi (origin unspecified)"));
  const scientific = indexes.legacy.find(row => /E\+/.test(row[0]));
  await render(`#care-site/${manifest.commit}/${encodeURIComponent(careKey("legacy", scientific[0]))}`);
  assert(text(view).includes(scientific[0]));
  assert(text(view).includes("Source code stored in scientific notation"));
  const visit = indexes.visittypes.find(row => row[3].length > 1);
  await render(`#care-site/${manifest.commit}/${careKey("visittypes", visit[0])}`);
  const sourceCard = descendants(view).find(element => element.tag === "section" && text(element).includes("OMOP place-of-service source"));
  assert(sourceCard.attributes.class.includes("tone-target"));
  await render("#caresites/visittypes/unmapped");
  assert(text(view).includes("118 results"));
  const visitGap = read(manifest.unmappedFiles.visittypes).unmapped[0];
  await render(`#care-site-propose/${manifest.commit}/${visitGap.id}`);
  descendants(view).find(element => element.attributes.inputmode === "numeric").value = "9202";
  descendants(view).find(element => element.tag === "textarea").value = "Propose a downstream Visit concept for this classification.";
  descendants(view).find(element => element.tag === "form").events.submit({ preventDefault() {} });
  assert(text(view).includes("Proposed mapping file: care_site_to_visit_type_map.csv"));
  const retry = indexes.sor.find(row => !requested.includes(careDetailFile(manifest, careKey("sor", row[0]))));
  failFile = careDetailFile(manifest, careKey("sor", retry[0]));
  await render(`#care-site/${manifest.commit}/${careKey("sor", retry[0])}`);
  assert(vm.runInContext("loadStatus.textContent", context).includes("could not be loaded"));
  failFile = undefined;
  await render(`#care-site/${manifest.commit}/${careKey("sor", retry[0])}`);
  assert(text(view).includes(retry[1]));
  await render("#caresites/sor/bulk");
  const upload = descendants(view).find(element => element.attributes.type === "file");
  upload.files = [new Blob([`source_code;OMOP_concept_id;mapping_id\n${missing.code};123456;${missing.id}\n`])];
  await upload.events.change();
  await descendants(view).find(element => element.tag === "button" && text(element).includes("Validate rows")).events.click();
  descendants(view).find(element => element.tag === "textarea").value = "Propose this care-site mapping in bulk.";
  descendants(view).find(element => element.tag === "form").events.submit({ preventDefault() {} });
  assert(text(view).includes("Bulk mapping proposal for SOR organisations"));
  assert(text(view).includes("New mappings: 1"));
});
