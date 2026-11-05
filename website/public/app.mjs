import { batchLimit, proposal } from "./proposal.mjs";

const view = document.querySelector("#view");
const loadStatus = document.querySelector("#load-status");
const athena = "https://athena.ohdsi.org/search-terms/";
let data;
let settings = {};
let selected = new Set();
let searchState = {};
let backlogState = {};
let drugData;
let drugLoad;
const drugSelections = new Set();
const drugStates = {};
const drugSearchCache = new Map();

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

function sourceSearchValues(code) {
  const details = data.sourceDetails?.[code];
  return [
    ...Object.values(details?.concept || {}),
    ...(details?.names || []).flatMap(name => Object.values(name)),
    ...(data.units[code] || []).map(unit => unit.description),
  ];
}

function sourceName(code) {
  const details = data.sourceDetails?.[code];
  const name = details?.names.find(name => name.Status === "Active") || details?.names[0];
  return name?.["National short name"] || details?.concept["Full definition"] || data.units[code]?.[0]?.description;
}

function sourceDetails(code) {
  const details = data.sourceDetails?.[code];
  if (!details || (!Object.keys(details.concept).length && !details.names.length)) {
    return node("p", {}, "No national terminology details found for this code in the supplied export.");
  }
  return node("div", {},
    node("p", {}, `National terminology · ${data.terminologyDate}. Dates are shown as supplied by the source.`),
    ...(Object.keys(details.concept).length ? [facts("National concept definition", Object.entries(details.concept), "source")] : []),
    ...details.names.map(name => facts("National name", Object.entries(name), "source")));
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
      match(query, [row.sourceCode, row.sourceName, row.conceptId, row.conceptName, data.targets[row.conceptId]?.code,
        ...sourceSearchValues(row.sourceCode)]));
    rows.sort((a, b) => Number(exact(b)) - Number(exact(a)));
    renderList(results, rows, row => node("li", {},
      link(node("span", { class: "code-source" }, `${row.sourceCode} · ${row.sourceName}`), `#mapping/${data.commit}/${row.id}`),
      ...(sourceName(row.sourceCode) ? [node("div", {}, sourceName(row.sourceCode))] : []),
      node("div", { class: "code-target" }, row.conceptName ? `→ ${row.conceptName} (${row.conceptId})` : "No target recorded")));
  };
  view.append(node("section", {}, node("h2", {}, "Search mappings"),
    searchBox("Code, concept ID or name", searchState.query, value => change("query", value)),
    node("div", { class: "filters" }, ...Object.entries(fields).map(([key, label]) =>
      filter(label, [...new Set(data.mappings.map(row => row[key]).filter(Boolean))].sort(),
        searchState[key], value => change(key, value)))), results));
  update();
}

function mappingValue(key, value) {
  if (["omop", "concept_id", "Historical target concept ID"].includes(key) && /^[1-9]\d*$/.test(value)) {
    return link(value, `${athena}terms/${value}`);
  }
  if (!["statusSetOn", "createdOn"].includes(key) || !/^-?\d+$/.test(value)) return value;
  if (value === "0") return "Not recorded";
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return value;
  return node("time", { datetime: date.toISOString(), title: `Source timestamp: ${value}` },
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium", timeStyle: "long", timeZone: "UTC",
    }).format(date));
}

function facts(title, pairs, tone = "") {
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
    sourceKey: "Source item",
    sourceFile: "Mapping file",
    sourceRow: "Data record",
    reviewState: "Review status",
    targetVocabulary: "Target vocabulary",
    validStartDate: "Mapping valid from",
    validEndDate: "Mapping valid until",
    invalidReason: "Invalid reason",
    recordedTarget: "Original target value",
    abbreviation: "Route abbreviation",
    "ADD_INFO:full_add_eng": "Preparation details (English)",
    "ADD_INFO:drugname": "Drug name",
    "ADD_INFO:dosageoptionname": "Dosage option",
    DoseForm: "Source dose form",
    DrugCount: "Drug count",
    RecordCount: "Record count",
    SourceUnit: "Source unit",
    TargetUnit: "Target unit",
    Factor: "Conversion factor",
    SourceId: "Source identifier",
    IngredientTranslation: "English ingredient name",
    concept_id: "Target concept ID",
    concept_name: "Target concept name",
  };
  const sourceFields = ["Column1", "npu", "freq", "description", "kind_of_property", "unit", "americanized",
    "vocabulary", "sourceFrequency", "preparation", "abbreviation", "SourceId", "SourceName", "IngredientTranslation",
    "DoseForm", "DrugCount", "RecordCount", "SourceUnit"];
  const targetFields = ["omop", "omop label", "concept_id", "concept_name", "TargetUnit", "targetVocabulary", "domainId",
    "recordedTarget", "Historical standard status"];
  return node("section", tone ? { class: `tone-${tone}` } : {}, node("h3", {}, title), node("dl", {},
    ...pairs.filter(([, value]) => value).map(([key, value]) => {
      const label = labels[key] || key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
      const fieldTone = targetFields.includes(key) || key.startsWith("Historical target") ? "target" :
        sourceFields.includes(key) ? "source" : "";
      return node("div", { class: `fact-row${fieldTone ? ` tone-${fieldTone}` : ""}` },
        node("dt", {}, label.charAt(0).toUpperCase() + label.slice(1)), node("dd", {}, mappingValue(key, value)));
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
  const concept = data.sourceDetails?.[row.sourceCode]?.concept || {};
  view.append(node("h2", {}, row.sourceCode),
    node("div", { class: "grid" },
      node("div", { class: "unit-mappings" },
        facts("Source", [["Vocabulary", row.vocabulary], ["Code", row.sourceCode], ["Name in mapping file", row.sourceName],
          ["National name", sourceName(row.sourceCode)], ["Full definition", concept["Full definition"]],
          ["System", concept.System], ["Component", concept.Component], ["Unit type", concept.Property],
          ["National unit", concept.Unit], ["National concept status", concept.Status],
          ["Replaces", concept.Replaces], ["Replaced by", concept["Replaced by"]],
          ["Source frequency", row.sourceFrequency], ["Recorded unit", row["ADD_INFO:unit"]]], "source"),
        node("details", {}, node("summary", {}, "All national terminology details"), sourceDetails(row.sourceCode))),
      facts("OMOP target", [["Concept ID", target ? link(row.conceptId, `${athena}terms/${row.conceptId}`) : row.conceptId],
        ["Name", row.conceptName], ["Domain", row.domainId], ["Vocabulary", target?.vocabulary],
        ["Vocabulary code", target?.code]], "target")),
    node("div", { class: "grid" },
      ...(units.length ? [node("div", { class: "unit-mappings" },
        ...units.map(unit => facts("Related unit mapping", Object.entries(unit).filter(([key]) => key !== "freq"))))] : []),
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
    const rows = data.unmapped.filter(row => {
      const concept = data.sourceDetails?.[row.code]?.concept || {};
      return (!backlogState.status || (concept.Status || "Unknown") === backlogState.status) &&
        match(backlogState.query, [row.code, ...sourceSearchValues(row.code)]);
    });
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
      const concept = data.sourceDetails?.[row.code]?.concept || {};
      const properties = [concept.System, concept.Component, concept.Property, concept.Unit].filter(Boolean);
      return node("li", {},
        node("label", {}, checkbox, node("span", { class: "code-source" }, ` ${row.code}`),
          ` · ${row.occurrences.startsWith("<") ? row.occurrences : Number(row.occurrences).toLocaleString()} occurrences`),
        node("strong", {}, sourceName(row.code) || "Description unavailable"),
        node("div", {}, properties.join(" · ")),
        node("div", {}, `National concept status: ${concept.Status || "Unknown"}`,
          concept["Replaced by"] ? ` · Replaced by ${concept["Replaced by"]}` : ""),
        node("details", {}, node("summary", {}, "Code details"), sourceDetails(row.code)));
    });
  };
  view.append(node("section", {}, node("h2", {}, "Unmapped NPU codes"),
    node("p", {}, "Published backlog for lab_dm_forsker. Counts refer to occurrences in that dataset."),
    node("div", { class: "filters" },
      searchBox("Code, Danish name, definition or property", backlogState.query, value => { backlogState.query = value; update(); }),
      filter("National concept status", ["Active", "Inactive", "Unknown"], backlogState.status,
        value => { backlogState.status = value; update(); }),
      filter("Sort", ["Code"], backlogState.sort, value => { backlogState.sort = value; update(); })),
    summary, proceed, results));
  selection();
  update();
}

function targetPicker(input, catalog = data, domain) {
  const choices = node("div", { class: "choice" });
  return node("div", { class: "target-picker tone-target" },
    searchBox("Find an OMOP target", "", query => {
      choices.replaceChildren();
      if (query.trim().length < 2) return;
      const found = Object.values(catalog.targets)
        .filter(target => (!domain || target.domain === domain) &&
          match(query, [target.id, target.name, target.code, target.vocabulary])).slice(0, 8);
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

function showProposal(id, commit, dataset = "labs") {
  const catalog = dataset === "drugs" ? drugData : data;
  const current = id && commit === catalog.commit && catalog.mappings.find(row => row.id === id);
  const items = id ? (current ? [dataset === "drugs" ? current.sourceKey : current.sourceCode] : []) :
    [...(dataset === "drugs" ? drugSelections : selected)];
  if (!items.length) {
    view.append(node("p", {}, "Open a mapping or select unmapped codes to begin."));
    return;
  }
  const status = node("p", { role: "status" });
  const preview = node("div");
  const form = node("form", { oninput: () => { preview.replaceChildren(); status.textContent = ""; } });
  const fields = items.map(item => {
    const drugSource = catalog.sources?.[item];
    const code = drugSource?.code || item;
    const target = node("input", { required: "", inputmode: "numeric", pattern: "[1-9][0-9]{0,9}" });
    const reason = node("textarea", { required: "", minlength: "10", maxlength: "1500" });
    const source = current || data.mappings.find(row => row.sourceCode === code);
    const unitDescription = data.units[code]?.[0]?.description;
    form.append(node("fieldset", {}, node("legend", { class: "code-source" }, code),
      node("div", { class: "source-summary tone-source" },
        node("p", {}, drugSource?.name || sourceName(code) || source?.sourceName || unitDescription || "Source description unavailable in this snapshot."),
        ...(drugSource?.preparation ? [node("p", {}, drugSource.preparation)] : []),
        node("details", {}, node("summary", {}, "Code details"), drugSource ? drugSourceDetails(drugSource) : sourceDetails(code))),
      ...(current ? [node("p", { class: "code-target" }, `${current.reviewState === "Needs review" ? "Existing proposal" : "Current target"}: ${current.conceptName || "Name unavailable"} (${current.conceptId || "no ID"})`)] : []),
      targetPicker(target, catalog, drugSource ? (drugSource.category === "routes" ? "Route" : "Drug") : undefined),
      node("label", { class: "target-picker tone-target" }, "Proposed OMOP concept ID", target),
      node("label", {}, "Why is this target appropriate?", reason)));
    if (current?.reviewState === "Needs review") target.value = current.conceptId;
    return { code, item, target, reason };
  });
  const previewButton = node("button", { type: "submit" }, "Preview public issue");
  form.append(previewButton);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const input = { dataset, commit: catalog.commit, rows: fields.map(({ code, item, target, reason }) =>
      ({ code, ...(dataset === "drugs" ? { item } : {}), mapping: current?.id, target: target.value, reason: reason.value })) };
    try {
      const issue = proposal(catalog, input);
      preview.replaceChildren(node("h3", {}, issue.title), node("pre", {}, issue.body));
      if (settings.siteKey) mountSubmission(preview, form, input, status);
      else preview.append(node("p", {}, "Submission is unavailable in this preview."));
    } catch (error) {
      status.textContent = error.message;
    }
  });
  view.append(node("section", {}, node("h2", {}, current?.reviewState === "Needs review" ? "Review mapping proposal" : current ? "Suggest a correction" : "Propose new mappings"),
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
        drugSelections.clear();
      } catch (error) {
        status.textContent = error.message;
        turnstile.reset(widget);
      } finally {
        form.inert = false;
      }
    });
  }).catch(() => { status.textContent = "The spam check could not load. Reload and try again."; });
}

function drugRecords(source) {
  return source.detailIds ? source.detailIds.map(id => drugData.referenceRecords[id]) : source.details || [];
}

function drugMatches(query, source) {
  if (!drugSearchCache.has(source.id)) {
    drugSearchCache.set(source.id, [source.code, source.name, source.preparation,
      ...drugRecords(source).flatMap(record => Object.values(record))].filter(Boolean).join(" ").toLocaleLowerCase());
  }
  return match(query, [drugSearchCache.get(source.id)]);
}

function drugFileLink(file, label = "View source file") {
  return link(label, `https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP/blob/${drugData.commit}/${encodeURIComponent("Drugs (Medications and Vaccines)/" + file)}`);
}

function drugSourceDetails(source) {
  const records = drugRecords(source);
  const container = node("div");
  if (source.backlogReason) container.append(node("p", {}, source.backlogReason));
  container.append(node("p", {}, source.category === "vaccines"
    ? "Historical DDV preparation input. Counts belong to individual source combinations."
    : source.category === "routes" ? "Route labels and mapping notes come from the published route mapping file."
      : "Historical DKMA working export named 4 January 2021. Reference targets and statuses describe that export."));
  if (source.referenceFile) container.append(drugFileLink(source.referenceFile, "View reference file"));
  if (records.length) {
    const list = node("div");
    renderList(list, records, record => node("li", {}, node("details", {},
      node("summary", {}, [record["Product name"], record["Ingredient name"], record["Dosage option"],
        record["Pharmaceutical form"], `Source record ${record["Source record"]}`].filter(Boolean).join(" · ")),
      facts("Source details", Object.entries(record), "source"))));
    container.append(list);
  } else if (source.category !== "routes") {
    container.append(node("p", {}, "Additional source details are unavailable for this identifier."));
  }
  for (const id of source.supportIds || []) {
    const support = drugData.supportRecords[id];
    container.append(facts("Supporting reference", Object.entries(support.fields), "source"),
      drugFileLink("reference_data/medications/" + support.file, "View supporting file"));
  }
  return container;
}

function drugNavigation(category = "products", mode = "review") {
  const medication = ["products", "ingredients"].includes(category);
  const topic = medication ? "products" : category;
  const topics = [["products", "Medications"], ["vaccines", "Vaccines"], ["routes", "Administration routes"]];
  const navigation = node("nav", { class: "topic-navigation", "aria-label": "Drug topics and actions" },
    ...topics.map(([key, label]) => node("a", {
      href: `#drugs/${key}/review`, class: "topic-tab", ...(key === topic ? { "aria-current": "location" } : {}),
    }, label)));
  const context = node("div", {
    class: "topic-context", style: `--topic-column: ${topics.findIndex(([key]) => key === topic) + 1}`,
  }, node("p", { class: "topic-context-title" }, `Actions for ${drugData.categories[category]}`));
  if (medication) context.append(node("div", { class: "topic-subcategories" },
    ...[["products", "Products"], ["ingredients", "Ingredients"]].map(([key, label]) => node("a", {
      href: `#drugs/${key}/${mode}`, ...(key === category ? { "aria-current": "location" } : {}),
    }, label))));
  context.append(node("div", { class: "topic-actions" },
    ...[["review", "Review mappings"], ["unmapped", "Suggest new mappings"]].map(([key, label]) => node("a", {
      href: `#drugs/${category}/${key}`, ...(key === mode ? { "aria-current": "page" } : {}),
    }, label))));
  navigation.append(context);
  view.append(navigation);
}

function showDrugSection(category, mode) {
  if (!drugData.categories[category]) category = "products";
  drugNavigation(category, mode);
  const backlog = mode === "unmapped";
  const state = drugStates[category + mode] ||= {};
  const results = node("div");
  const selectionStatus = node("p", { role: "status" });
  const proceed = node("button", { type: "button", onclick: () => { location.hash = "drug-propose"; } }, "Propose selected mappings");
  const updateSelection = () => {
    selectionStatus.textContent = `${drugSelections.size} of ${batchLimit} source items selected`;
    proceed.disabled = !drugSelections.size;
  };
  const update = () => {
    const rows = (backlog ? drugData.unmapped : drugData.mappings).filter(row => {
      const source = drugData.sources[row.sourceKey];
      return row.category === category && (!state.status || row.reviewState === state.status) &&
        (!state.mappingStatus || row.mappingStatus === state.mappingStatus) &&
        (!state.vocabulary || row.targetVocabulary === state.vocabulary) &&
        (drugMatches(state.query, source) || (!backlog && match(state.query, [row.conceptId, row.conceptName,
          row.comment, row.recordedTarget, row.abbreviation, drugData.targets[row.conceptId]?.code])));
    });
    const query = (state.query || "").trim().toLocaleLowerCase();
    rows.sort((a, b) => Number(b.sourceCode?.toLocaleLowerCase() === query || b.code?.toLocaleLowerCase() === query || b.conceptId === query) -
      Number(a.sourceCode?.toLocaleLowerCase() === query || a.code?.toLocaleLowerCase() === query || a.conceptId === query));
    renderList(results, rows, row => {
      const source = drugData.sources[row.sourceKey];
      if (!backlog) return node("li", {},
        link(node("span", { class: "code-source" }, `${source.code} · ${source.name}`), `#drug-mapping/${drugData.commit}/${row.id}`),
        ...(source.preparation ? [node("div", {}, source.preparation)] : []),
        node("div", { class: "code-target" }, row.conceptId ? `→ ${row.conceptName || "Target name unavailable"} (${row.conceptId})` : "No usable target recorded"),
        node("div", {}, `${row.reviewState} · ${row.mappingStatus}`));
      const checkbox = node("input", { type: "checkbox", onchange: () => {
        if (checkbox.checked && drugSelections.size >= batchLimit) {
          checkbox.checked = false;
          selectionStatus.textContent = `Select up to ${batchLimit} source items per proposal.`;
          return;
        }
        if (checkbox.checked) drugSelections.add(source.id);
        else drugSelections.delete(source.id);
        updateSelection();
      } });
      checkbox.checked = drugSelections.has(source.id);
      return node("li", {}, node("label", {}, checkbox, node("span", { class: "code-source" }, ` ${source.code} · ${source.name}`)),
        ...(source.preparation ? [node("p", {}, source.preparation)] : []),
        node("p", {}, source.backlogReason),
        node("details", {}, node("summary", {}, "Source details"), drugSourceDetails(source)));
    });
  };
  const change = (key, value) => { state[key] = value; update(); };
  const categoryRows = drugData.mappings.filter(row => row.category === category);
  const controls = node("div", { class: "filters" },
    searchBox("Source code, name, ingredient, ATC code or target", state.query, value => change("query", value)));
  if (!backlog) controls.append(
    filter("Review status", ["Published", "Needs review"], state.status, value => change("status", value)),
    filter("Mapping status", [...new Set(categoryRows.map(row => row.mappingStatus))].sort(), state.mappingStatus,
      value => change("mappingStatus", value)),
    filter("Target vocabulary", [...new Set(categoryRows.map(row => row.targetVocabulary).filter(Boolean))].sort(),
      state.vocabulary, value => change("vocabulary", value)));
  view.append(node("section", {}, node("h2", {}, `${drugData.categories[category]} · ${backlog ? "Suggest new mappings" : "Review mappings"}`),
    node("p", {}, backlog
      ? category === "vaccines" ? "Preparations in the historical DDV input without a matched published preparation. Confirm the source identity before suggesting a target. Existing additional proposals are available under Review mappings → Needs review."
        : category === "routes" ? "Source labels without a usable positive target in the route mapping file. Some labels may require clarification."
          : "Gaps recorded in the published medication file and historical DKMA working export, reconciled against published positive targets. This list covers the available working data."
      : "Each result represents a mapping record. Several targets or preparations can share a source code."),
    controls, ...(backlog ? [selectionStatus, proceed] : []), results));
  updateSelection();
  update();
}

function showDrugMapping(id, commit) {
  const row = commit === drugData.commit && drugData.mappings.find(row => row.id === id);
  if (!row) {
    view.append(node("p", {}, "This mapping link refers to a different snapshot or an unknown mapping."));
    return;
  }
  const source = drugData.sources[row.sourceKey];
  const target = drugData.targets[row.conceptId] || {};
  drugNavigation(row.category);
  view.append(node("h2", {}, source.name), node("p", {}, `${source.code} · ${row.reviewState}`),
    node("div", { class: "grid" },
      node("div", { class: "unit-mappings" },
        facts("Danish source", [["Code", source.code], ["Name", source.name], ["Preparation", source.preparation],
          ["Vocabulary", row.vocabulary], ["Historical frequency", row.sourceFrequency]], "source"), drugSourceDetails(source)),
      facts(row.reviewState === "Needs review" ? "Proposed OMOP target" : "OMOP target", [
        ["Concept ID", row.conceptId ? link(row.conceptId, `${athena}terms/${row.conceptId}`) : "No usable target recorded"],
        ["Name", row.conceptName || "Target name unavailable in the mapping files"], ["Domain", row.domainId],
        ["Vocabulary", target.vocabulary || row.targetVocabulary], ["Vocabulary code", target.code],
        ["Concept class", target.conceptClass], ["Metadata source", target.metadataSource],
        ["Historical target valid from", target.validFrom], ["Historical target valid until", target.validUntil]], "target")),
    facts("Mapping record", Object.entries(row).filter(([key]) => !["id", "sourceKey", "category", "sourceName", "sourceCode", "conceptId", "conceptName"].includes(key))),
    node("div", { class: "actions" }, drugFileLink(row.sourceFile),
      link(row.reviewState === "Needs review" ? "Review this proposal" : "Suggest a correction", `#drug-correct/${drugData.commit}/${row.id}`)));
}

async function loadDrugs() {
  if (!drugLoad) drugLoad = fetch("drugs.json").then(response => {
    if (!response.ok) throw new Error("Drug mapping data could not be loaded.");
    return response.json();
  }).then(value => { drugData = value; }).catch(error => { drugLoad = undefined; throw error; });
  await drugLoad;
}

async function render() {
  view.replaceChildren();
  const hash = location.hash;
  const [route, commit, id] = hash.slice(1).split("/");
  if (["drugs", "drug-mapping", "drug-correct", "drug-propose", "downloads"].includes(route)) {
    loadStatus.textContent = "Loading drug and vaccine mappings…";
    try {
      await loadDrugs();
    } catch {
      if (hash === location.hash) loadStatus.textContent = "Drug mappings could not be loaded. Reload or select the section again to retry.";
      return;
    }
    if (hash !== location.hash) return;
    loadStatus.textContent = "";
  } else loadStatus.textContent = "";
  if (route === "drugs") showDrugSection(commit, id);
  else if (route === "drug-mapping") showDrugMapping(id, commit);
  else if (route === "drug-correct" || route === "drug-propose") showProposal(id, commit, "drugs");
  else if (route === "unmapped") {
    view.append(node("nav", { class: "section-nav", "aria-label": "Measurements" },
      link("Review mappings", "#search"), link("Suggest new mappings", "#unmapped")));
    showBacklog();
  }
  else if (route === "mapping") showMapping(id, commit);
  else if (route === "correct" || route === "propose") showProposal(id, commit);
  else if (route === "downloads") view.append(node("section", {}, node("h2", {}, "Download mapping files"),
    ...[["Measurements", data.downloads], ["Drugs & vaccines", drugData.downloads]].map(([label, files]) =>
      node("div", {}, node("h3", {}, label), node("ul", {}, ...Object.entries(files).map(([name, url]) => node("li", {}, link(name, url))))))));
  else if (route === "about") view.append(node("section", {}, node("h2", {}, "About & contributing"),
    node("p", {}, "The Danish OHDSI Node maintains these mappings. Browse a mapping to propose a correction, or select up to ten source items from a new-mapping list."),
    node("p", {}, "Every submission includes your proposed OMOP target and justification. Preview the public issue before submitting. A GitHub account is not required."),
    node("p", {}, "Source counts and historical reference details belong to their original datasets. Maintainers review proposals before updating the published mappings."),
    link("Visit the mapping repository", "https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP")));
  else {
    view.append(node("nav", { class: "section-nav", "aria-label": "Measurements" },
      link("Review mappings", "#search"), link("Suggest new mappings", "#unmapped")));
    showSearch();
  }
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
