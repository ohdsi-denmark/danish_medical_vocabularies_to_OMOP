import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { coverageLabel, renderDashboard } from "./public/dashboard.mjs";
import { createCarePages } from "./public/care_ui.mjs";
import { expandProcedures } from "./public/procedure_data.mjs";
import { batchLimit, procedureProposal, procedureRelationships, proposal } from "./public/proposal.mjs";
import * as bulk from "./public/bulk.mjs";

const read = file => JSON.parse(readFileSync(new URL(`dist/${file}`, import.meta.url), "utf8"));
const report = read("dashboard.json");
const procedures = expandProcedures(read("procedures.json"));
const conditions = expandProcedures(read("conditions.json"));

test("dashboard totals reconcile without summing auxiliary or overlapping source tables", () => {
  assert(readFileSync(new URL("dist/dashboard.json", import.meta.url)).length < 32768);
  assert.equal(report.topics.length, 5);
  for (const topic of report.topics) {
    const primary = report.tables.filter(row => row.topic === topic.id && row.includedInTopic);
    for (const key of ["total", "mapped", "unmapped"]) assert.equal(topic[key], primary.reduce((sum, row) => sum + row[key], 0));
  }
  for (const row of [...report.topics, ...report.tables, ...report.sourceTables]) {
    assert.equal(row.mapped + row.unmapped, row.total);
    assert(row.mapped <= row.total);
    assert.equal(row.percentage, row.total ? 100 * row.mapped / row.total : null);
  }
  const procedure = report.topics.find(row => row.id === "procedures");
  assert.equal(procedure.total, Object.keys(procedures.sources).length);
  assert.equal(procedure.mapped, new Set(procedures.mappings.filter(row => /^[1-9]\d*$/.test(row.conceptId)).map(row => row.sourceCode)).size);
  const condition = report.topics.find(row => row.id === "conditions");
  assert.equal(condition.total, Object.keys(conditions.sources).length);
  assert.equal(condition.unmapped, conditions.uncovered.length);
  const care = read("caresites.json");
  const careTopic = report.topics.find(row => row.id === "caresites");
  assert.equal(careTopic.total, care.stats.sor.sources + care.stats.legacy.sources);
  assert.equal(careTopic.mapped, care.stats.sor.mapped + care.stats.legacy.mapped);
  assert.equal(report.sourceTables.length, 7);
  assert.equal(report.tables.find(row => row.id === "care-sor").humanVerified, 81);
});

test("coverage labels handle unavailable inventories and avoid rounding incomplete coverage to 100%", () => {
  assert.equal(coverageLabel({ total: 0, percentage: null }), "Not available");
  assert.equal(coverageLabel({ total: 10000, percentage: 99.99 }), ">99.9%");
  assert.equal(coverageLabel({ total: 10000, percentage: 0.01 }), "<0.1%");
  assert.equal(coverageLabel({ total: 1, percentage: 100 }), "100%");
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.events[key] = callback; }
}
const text = element => typeof element === "string" ? element : [element.textContent || "", ...element.children.map(text)].join(" ");
const descendants = element => [element, ...element.children.filter(child => typeof child !== "string").flatMap(descendants)];

async function bootstrap(hash, failure) {
  const view = new Element("main");
  const version = new Element("p");
  const status = new Element("p");
  const requested = [];
  const events = {};
  let fail = failure;
  const context = vm.createContext({
    document: { querySelector: selector => ({ "#view": view, "#version": version, "#load-status": status })[selector] || new Element("div"), createElement: tag => new Element(tag) },
    location: { hash }, addEventListener: (name, callback) => { events[name] = callback; },
    fetch: async path => {
      requested.push(path);
      if (path === fail) return new Response("Unavailable", { status: 503 });
      return Response.json(path === "api/config" ? {} : read(path));
    }, renderDashboard, createCarePages, expandProcedures, batchLimit, procedureProposal, procedureRelationships, proposal, ...bulk,
  });
  const source = readFileSync(new URL("public/app.mjs", import.meta.url), "utf8");
  await vm.runInContext("(async () => {" + source.slice(source.indexOf("const view =")) + "\n})()", context);
  return { view, version, status, requested, navigate: async hash => { context.location.hash = hash; await events.hashchange(); }, recover: () => { fail = undefined; } };
}

test("the landing page loads only a small coverage summary and filters tables by topic", async () => {
  const page = await bootstrap("");
  assert.deepEqual(page.requested, ["dashboard.json", "api/config"]);
  assert(text(page.view).includes("Mapping coverage"));
  assert(text(page.view).includes("Coverage by mapping table"));
  assert(text(page.view).includes("DNPR source tables"));
  assert(text(page.view).includes("Mapping file only; no separate DNK unmapped inventory supplied"));
  assert(text(page.version).includes(report.commit.slice(0, 12)));
  assert.equal(descendants(page.view).filter(element => element.tag === "article").length, 5);
  const meters = descendants(page.view).filter(element => element.attributes.role === "meter");
  assert(meters.length >= 5);
  assert(meters.every(element => element.attributes["aria-valuenow"] <= element.attributes["aria-valuemax"]));
  const select = descendants(page.view).find(element => element.attributes["aria-label"] === "Filter dashboard by topic");
  select.events.change({ target: { value: "conditions" } });
  let rows = descendants(page.view).filter(element => element.tag === "tbody").flatMap(element => element.children);
  assert(rows.some(row => text(row).includes("t_diag")));
  assert(!rows.some(row => text(row).includes("t_sksopr")));
  assert(!rows.some(row => text(row).includes("Medication products")));
  select.events.change({ target: { value: "drugs" } });
  assert(descendants(page.view).some(element => element.tag === "section" && element.hidden && text(element).includes("DNPR source tables")));
  assert.deepEqual(page.requested, ["dashboard.json", "api/config"]);
  await page.navigate("#search");
  assert.equal(page.requested.at(-1), "data.json");
  assert(text(page.view).includes("Search mappings"));
  await page.navigate("#dashboard");
  assert.equal(page.requested.filter(path => path === "dashboard.json").length, 1);
  assert(text(page.view).includes("Mapping coverage"));
});

test("existing deep links load their own data and dashboard failures can be retried", async () => {
  const measurements = await bootstrap("#search");
  assert.deepEqual(measurements.requested, ["data.json", "api/config"]);
  assert(text(measurements.view).includes("Search mappings"));
  const procedure = await bootstrap("#procedures/review");
  assert.deepEqual(procedure.requested, ["procedures.json", "api/config"]);
  assert(text(procedure.view).includes("Review procedure mappings"));
  const drugs = read("drugs.json");
  const drug = drugs.mappings.find(row => row.category === "products");
  const correction = await bootstrap(`#drug-correct/${drugs.commit}/${drug.id}`);
  assert.deepEqual(correction.requested, ["drugs.json", "api/config"]);
  assert(descendants(correction.view).some(element => element.tag === "form"));
  assert(text(correction.view).includes("Proposed OMOP concept ID"));
  const failed = await bootstrap("", "dashboard.json");
  assert(text(failed.status).includes("Mapping coverage could not be loaded"));
  failed.recover();
  await failed.navigate("#dashboard");
  assert(text(failed.view).includes("Mapping coverage"));
  assert.equal(failed.requested.filter(path => path === "dashboard.json").length, 2);
});
