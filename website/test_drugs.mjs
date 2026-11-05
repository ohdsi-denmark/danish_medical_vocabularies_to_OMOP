import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { proposal } from "./public/proposal.mjs";
import worker from "./worker.mjs";

const readData = name => JSON.parse(readFileSync(new URL(`dist/${name}`, import.meta.url), "utf8"));
const drugs = readData("drugs.json");
const submissionData = readData("drug-proposals.json");
const labs = readData("data.json");
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

test("submission endpoint validates drug identities and prevents duplicate issues", async () => {
  const originalFetch = globalThis.fetch;
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("migrations/0001_submissions.sql", import.meta.url), "utf8"));
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
  let issues = 0;
  let rateAllowed = true;
  let assetPath;
  const repository = "example/test-mappings";
  const env = {
    TURNSTILE_SITE_KEY: "test", TURNSTILE_SECRET: "test", GITHUB_APP_CLIENT_ID: "test",
    GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_INSTALLATION_ID: "1", GITHUB_REPOSITORY: repository,
    PROPOSAL_RATE: { limit: async () => ({ success: rateAllowed }) },
    ASSETS: { fetch: async url => { assetPath = url.pathname; return Response.json(submissionData); } },
    SUBMISSIONS: { prepare: query => ({ bind: (...args) => ({
      first: async () => database.prepare(query).get(...args),
      run: async () => ({ meta: database.prepare(query).run(...args) }),
    }) }) },
  };
  globalThis.fetch = async url => {
    if (url.includes("siteverify")) return Response.json({ success: true, action: "mapping_proposal", hostname: "local.test" });
    if (url.includes("access_tokens")) return Response.json({ token: "test" });
    issues++;
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
    rateAllowed = false;
    assert.equal((await send(payload)).status, 429);
    assert.equal(issues, 1);
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
}
const text = element => typeof element === "string" ? element :
  [element.textContent || "", ...element.children.map(text)].join(" ");
const descendants = element => [element, ...element.children.filter(child => typeof child !== "string").flatMap(descendants)];

test("navigation, search, detail views and proposal preview use the selected collection", async () => {
  const view = new Element("main");
  const context = vm.createContext({
    document: { querySelector: selector => selector === "#view" ? view : new Element("div"), createElement: tag => new Element(tag) },
    location: { hash: "#drugs/products/review" }, snapshot: drugs, labs, proposal, batchLimit: 10,
    fetch: async () => Response.json(drugs),
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
  context.location.hash = "#drugs/routes/unmapped";
  await vm.runInContext("render()", context);
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
});
