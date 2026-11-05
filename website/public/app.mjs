import { batchLimit, proposal } from "./proposal.mjs";

const view = document.querySelector("#view");
const loadStatus = document.querySelector("#load-status");
const athena = "https://athena.ohdsi.org/search-terms/";
let data;
let settings = {};
let selected = new Set();
let searchState = {};
let backlogState = {};

function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith("on")) element.addEventListener(name.slice(2), value);
    else element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

function link(label, href) {
  return node("a", { href }, label);
}

function searchBox(label, value, change) {
  const input = node("input", { type: "search", oninput: event => change(event.target.value) });
  input.value = value || "";
  return node("label", {}, label, input);
}

function filter(label, values, value, change) {
  const select = node("select", { onchange: event => change(event.target.value) },
    node("option", { value: "" }, "All"),
    ...values.map(option => node("option", { value: option }, option)));
  select.value = value || "";
  return node("label", {}, label, select);
}

function match(query, fields) {
  const haystack = fields.filter(Boolean).join(" ").toLocaleLowerCase();
  return (query || "").trim().toLocaleLowerCase().split(/\s+/).every(word => haystack.includes(word));
}

function renderList(container, rows, makeRow) {
  const list = node("ul", { class: "results" });
  let limit = 30;
  const more = node("button", { type: "button", onclick: () => {
    list.append(...rows.slice(limit, limit + 30).map(makeRow));
    limit += 30;
    more.hidden = limit >= rows.length;
  } }, "Show more");
  more.hidden = limit >= rows.length;
  list.append(...rows.slice(0, limit).map(makeRow));
  container.replaceChildren(node("p", { role: "status" }, `${rows.length.toLocaleString()} results`), list, more);
}

function showSearch() {
  const results = node("div");
  const fields = { vocabulary: "Source vocabulary", domainId: "Target domain",
    mappingStatus: "Mapping status", equivalence: "Equivalence" };
  const change = (key, value) => { searchState[key] = value; update(); };
  const update = () => {
    const query = (searchState.query || "").trim().toUpperCase();
    const exact = row => [row.sourceCode, row.conceptId, data.targets[row.conceptId]?.code].includes(query);
    const rows = data.mappings.filter(row =>
      Object.keys(fields).every(key => !searchState[key] || row[key] === searchState[key]) &&
      match(query, [row.sourceCode, row.sourceName, row.conceptId, row.conceptName, data.targets[row.conceptId]?.code]));
    rows.sort((a, b) => Number(exact(b)) - Number(exact(a)));
    renderList(results, rows, row => node("li", {},
      link(`${row.sourceCode} · ${row.sourceName}`, `#mapping/${data.commit}/${row.id}`),
      node("div", {}, row.conceptName ? `→ ${row.conceptName} (${row.conceptId})` : "No target recorded")));
  };
  view.append(node("section", {}, node("h2", {}, "Search mappings"),
    searchBox("Code, concept ID or name", searchState.query, value => change("query", value)),
    node("div", { class: "filters" }, ...Object.entries(fields).map(([key, label]) =>
      filter(label, [...new Set(data.mappings.map(row => row[key]).filter(Boolean))].sort(),
        searchState[key], value => change(key, value)))), results));
  update();
}

function mappingValue(key, value) {
  if (!["statusSetOn", "createdOn"].includes(key) || !/^-?\d+$/.test(value)) return value;
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return value;
  return node("time", { datetime: date.toISOString(), title: `Source timestamp: ${value}` },
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium", timeStyle: "long", timeZone: "UTC",
    }).format(date));
}

function facts(title, pairs) {
  const labels = {
    matchScore: "Match score",
    mappingStatus: "Mapping status",
    equivalence: "Equivalence",
    statusSetBy: "Status set by",
    statusSetOn: "Status set on",
    mappingType: "Mapping type",
    comment: "Comment",
    createdBy: "Created by",
    createdOn: "Created on",
    assignedReviewer: "Assigned reviewer",
    sourceAutoAssignedConceptIds: "Automatically assigned source concept IDs",
    Column1: "Source row number",
    npu: "Source code",
    freq: "Source frequency",
    description: "Description",
    kind_of_property: "Unit type",
    unit: "Source unit",
    americanized: "Source unit (US spelling)",
    omop: "OMOP unit concept ID",
    "omop label": "OMOP unit label",
    "additional computations": "Additional computations",
    justification: "Justification",
  };
  return node("section", {}, node("h3", {}, title), node("dl", {},
    ...pairs.filter(([, value]) => value).flatMap(([key, value]) => {
      const label = labels[key] || key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
      return [node("dt", {}, label.charAt(0).toUpperCase() + label.slice(1)), node("dd", {}, mappingValue(key, value))];
    })));
}

function showMapping(id, commit) {
  const row = commit === data.commit && data.mappings.find(mapping => mapping.id === id);
  if (!row) {
    view.append(node("p", {}, "This mapping link refers to a different snapshot or an unknown mapping."));
    return;
  }
  const target = data.targets[row.conceptId];
  const units = data.units[row.sourceCode] || [];
  view.append(node("h2", {}, row.sourceCode),
    node("div", { class: "grid" },
      facts("Source", [["Vocabulary", row.vocabulary], ["Code", row.sourceCode], ["Name", row.sourceName],
        ["Source frequency", row.sourceFrequency], ["Recorded unit", row["ADD_INFO:unit"]]]),
      facts("OMOP target", [["Concept ID", target ? link(row.conceptId, `${athena}terms/${row.conceptId}`) : row.conceptId],
        ["Name", row.conceptName], ["Domain", row.domainId], ["Vocabulary", target?.vocabulary],
        ["Vocabulary code", target?.code]])),
    node("div", { class: "grid" },
      ...(units.length ? [node("div", { class: "unit-mappings" },
        ...units.map(unit => facts("Related unit mapping", Object.entries(unit))))] : []),
      facts("Mapping record", Object.entries(row).filter(([key]) =>
        !["id", "vocabulary", "sourceCode", "sourceName", "sourceFrequency", "ADD_INFO:unit", "conceptId", "conceptName", "domainId"].includes(key)))),
    node("div", { class: "actions" }, link("Download source file", data.downloads[row.vocabulary]),
      link("Suggest a correction", `#correct/${data.commit}/${id}`)));
}

function showBacklog() {
  const results = node("div");
  const summary = node("p", { role: "status" });
  const proceed = node("button", { type: "button", onclick: () => { location.hash = "propose"; } }, "Propose selected mappings");
  const selection = () => {
    summary.textContent = `${selected.size} of ${batchLimit} codes selected`;
    proceed.disabled = !selected.size;
  };
  const update = () => {
    const rows = data.unmapped.filter(row => match(backlogState.query, [row.code]));
    if (backlogState.sort) rows.sort((a, b) => a.code.localeCompare(b.code));
    renderList(results, rows, row => {
      const checkbox = node("input", { type: "checkbox", onchange: () => {
        if (checkbox.checked && selected.size >= batchLimit) {
          checkbox.checked = false;
          summary.textContent = `Select up to ${batchLimit} codes per proposal.`;
          return;
        }
        if (checkbox.checked) selected.add(row.code);
        else selected.delete(row.code);
        selection();
      } });
      checkbox.checked = selected.has(row.code);
      return node("li", {}, node("label", {}, checkbox, ` ${row.code} · ${row.occurrences.startsWith("<") ? row.occurrences : Number(row.occurrences).toLocaleString()} occurrences`));
    });
  };
  view.append(node("section", {}, node("h2", {}, "Unmapped NPU codes"),
    node("p", {}, "Published backlog for lab_dm_forsker. Counts refer to occurrences in that dataset."),
    node("div", { class: "filters" },
      searchBox("Find a code", backlogState.query, value => { backlogState.query = value; update(); }),
      filter("Sort", ["Code"], backlogState.sort, value => { backlogState.sort = value; update(); })),
    summary, proceed, results));
  selection();
  update();
}

function targetPicker(input) {
  const choices = node("div", { class: "choice" });
  return node("div", {},
    searchBox("Find an OMOP target", "", query => {
      choices.replaceChildren();
      if (query.trim().length < 2) return;
      const found = Object.values(data.targets)
        .filter(target => match(query, [target.id, target.name, target.code, target.vocabulary])).slice(0, 8);
      choices.append(...found.map(target => node("div", {}, node("button", {
        type: "button", onclick: () => {
          input.value = target.id;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          choices.replaceChildren(node("p", {}, `Selected ${target.name} (${target.id})`));
        },
      }, `${target.name || target.id} · ${target.id} · ${target.domain || "Domain unavailable"}`))));
      if (!found.length) choices.append("No matches in the site's target catalogue.");
    }), choices, node("p", {}, "You can also ", link("search Athena", athena + "start"), " and enter the concept ID below."));
}

function showProposal(id, commit) {
  const current = id && commit === data.commit && data.mappings.find(row => row.id === id);
  const codes = id ? (current ? [current.sourceCode] : []) : [...selected];
  if (!codes.length) {
    view.append(node("p", {}, "Open a mapping or select unmapped codes to begin."));
    return;
  }
  const status = node("p", { role: "status" });
  const preview = node("div");
  const form = node("form", { oninput: () => { preview.replaceChildren(); status.textContent = ""; } });
  const fields = codes.map(code => {
    const target = node("input", { required: "", inputmode: "numeric", pattern: "[1-9][0-9]{0,9}" });
    const reason = node("textarea", { required: "", minlength: "10", maxlength: "1500" });
    const source = current || data.mappings.find(row => row.sourceCode === code);
    const unitDescription = data.units[code]?.[0]?.description;
    form.append(node("fieldset", {}, node("legend", {}, code),
      node("p", {}, source?.sourceName || unitDescription || "Source description unavailable in this snapshot."),
      ...(current ? [node("p", {}, `Current target: ${current.conceptName || "None"} (${current.conceptId || "no ID"})`)] : []),
      targetPicker(target), node("label", {}, "Proposed OMOP concept ID", target),
      node("label", {}, "Why is this target appropriate?", reason)));
    return { code, target, reason };
  });
  const previewButton = node("button", { type: "submit" }, "Preview public issue");
  form.append(previewButton);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const input = { commit: data.commit, rows: fields.map(({ code, target, reason }) =>
      ({ code, mapping: current?.id, target: target.value, reason: reason.value })) };
    try {
      const issue = proposal(data, input);
      preview.replaceChildren(node("h3", {}, issue.title), node("pre", {}, issue.body));
      if (settings.siteKey) mountSubmission(preview, form, input, status);
      else preview.append(node("p", {}, "Submission is unavailable in this preview."));
    } catch (error) {
      status.textContent = error.message;
    }
  });
  view.append(node("section", {}, node("h2", {}, current ? "Suggest a correction" : "Propose new mappings"),
    node("p", {}, "Your proposal will appear publicly on GitHub. Keep patient information and personal contact details out of the form."),
    form, preview, status));
}

function mountSubmission(preview, form, input, status) {
  const challenge = node("div");
  const send = node("button", { type: "button", disabled: "" }, "Submit public issue");
  let token;
  let widget;
  preview.append(challenge, send);
  settings.turnstile.then(turnstile => {
    if (!challenge.isConnected) return;
    widget = turnstile.render(challenge, {
      sitekey: settings.siteKey,
      action: "mapping_proposal",
      callback: value => { token = value; send.disabled = false; },
      "expired-callback": () => { token = undefined; send.disabled = true; },
      "error-callback": () => { status.textContent = "The spam check could not load. Try previewing again."; },
    });
    send.addEventListener("click", async () => {
      send.disabled = true;
      form.inert = true;
      try {
        const response = await fetch("api/proposals", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, token }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        status.replaceChildren("Proposal submitted. ", link("View the GitHub issue", result.url));
        preview.replaceChildren();
        form.querySelector("button[type=submit]").disabled = true;
        selected.clear();
      } catch (error) {
        status.textContent = error.message;
        turnstile.reset(widget);
      } finally {
        form.inert = false;
      }
    });
  }).catch(() => { status.textContent = "The spam check could not load. Reload and try again."; });
}

function render() {
  view.replaceChildren();
  const [route, commit, id] = location.hash.slice(1).split("/");
  if (route === "unmapped") showBacklog();
  else if (route === "mapping") showMapping(id, commit);
  else if (route === "correct" || route === "propose") showProposal(id, commit);
  else if (route === "downloads") view.append(node("section", {}, node("h2", {}, "Download mapping files"),
    node("ul", {}, ...Object.entries(data.downloads).map(([label, url]) => node("li", {}, link(label, url))))));
  else showSearch();
}

try {
  const response = await fetch("data.json");
  if (!response.ok) throw new Error();
  data = await response.json();
  loadStatus.textContent = "";
  document.querySelector("#version").append("Mapping snapshot ", link(data.commit.slice(0, 12),
    `https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP/tree/${data.commit}`),
    data.omopRelease ? ` · OMOP vocabulary ${data.omopRelease}` : " · Target search uses concepts from the mapping files");
  addEventListener("hashchange", render);
  render();
  const config = await fetch("api/config").then(response => response.json()).catch(() => ({}));
  if (config.siteKey) {
    settings = { ...config, turnstile: new Promise((resolve, reject) => {
      const script = node("script", {
        src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
        onload: () => resolve(window.turnstile), onerror: reject,
      });
      document.head.append(script);
    }) };
    settings.turnstile.catch(() => {});
  }
} catch {
  loadStatus.textContent = "The mapping data could not be loaded. Try reloading the page.";
}
