import { careDetailFile, careFlagLabels, careKey, careSummary } from "./care_data.mjs";

export function createCarePages(ui) {
  const { node, link, facts, bulkTable, view } = ui;
  let manifest;
  let manifestLoad;
  const loads = new Map();
  const states = {};
  async function read(filename) {
    if (!loads.has(filename)) loads.set(filename, ui.request(filename).then(response => {
      if (!response.ok) throw new Error("Care-site data could not be loaded.");
      return response.json();
    }).then(value => {
      if (manifest && value.commit !== manifest.commit) throw new Error("Care-site data refers to a different snapshot.");
      return value;
    }).catch(error => { loads.delete(filename); throw error; }));
    return loads.get(filename);
  }
  async function loadManifest() {
    if (!manifestLoad) manifestLoad = read("caresites.json").then(value => { manifest = value; })
      .catch(error => { manifestLoad = undefined; throw error; });
    await manifestLoad;
    return manifest;
  }
  function navigation(category, mode = "review") {
    const topics = Object.keys(manifest.categories);
    const nav = node("nav", { class: "topic-navigation", "aria-label": "Care-site coding systems and actions" },
      ...Object.entries(manifest.categories).map(([key, title]) => node("a", {
        href: `#caresites/${key}/review`, class: "topic-tab", ...(key === category ? { "aria-current": "location" } : {}),
      }, title)));
    nav.append(node("div", { class: "topic-context", style: `--topic-column: ${topics.indexOf(category) + 1}` },
      node("p", { class: "topic-context-title" }, `Actions for ${manifest.categories[category]}`),
      node("div", { class: "topic-actions" },
      ...[["review", "Review mappings"], ["unmapped", "Suggest new mappings"], ["bulk", "Upload bulk changes"]].map(([key, label]) => node("a", {
        href: `#caresites/${category}/${key}`, ...(key === mode ? { "aria-current": "page" } : {}),
      }, label)))));
    view.append(nav);
  }
  async function list(category, mode, rows) {
    navigation(category, mode);
    if (mode === "bulk") {
      ui.showBulkUpload(category, { ...manifest, sources: {}, mappings: [], unmapped: [],
        loadBulkCandidates: async codes => careSummary(manifest, category, (await read(manifest.indexes[category])).rows, new Set(codes)),
      }, "caresites");
      return;
    }
    const backlog = mode === "unmapped";
    const state = states[`${category}/${mode}`] ||= {};
    const results = node("div");
    const download = node("div");
    const update = () => {
      const query = (state.query || "").trim();
      const matches = rows.filter(row => {
        const [code, name, method, records, flags] = row;
        return (backlog ? !records.length : records.length > 0) &&
          (!state.method || manifest.methods[method] === state.method) &&
          (!state.flag || careFlagLabels(manifest, flags).includes(state.flag)) &&
          (!state.verification || (state.verification === "Human verified" ? method === 0 : method !== 0)) &&
          (!query || ui.match(query, [code, name, ...records.flatMap(record => [record[1], ...(manifest.targets[record[1]]?.recordedLabels || []), manifest.targets[record[1]]?.name])]));
      });
      if (backlog && manifest.stats[category].unresolved) {
        const items = matches.map(row => ({ id: careKey(category, row[0]), sourceKey: careKey(category, row[0]), code: row[0], category }));
        download.replaceChildren(ui.backlogDownload(manifest, items, category, () => read(manifest.unmappedFiles[category])));
      }
      ui.renderList(results, matches, row => {
        const [code, name, method, records, flags] = row;
        const ids = [...new Set(records.map(record => record[1]))];
        return node("li", {}, link(node("span", { class: category === "visittypes" ? "code-target" : "code-source" }, `${code} · ${name}`),
          `#care-site/${manifest.commit}/${encodeURIComponent(careKey(category, code))}`),
          node("div", {}, `${manifest.methods[method]} · ${method === 0 ? "Human verified" : method === 4 ? "Review status not supplied" : "Not human verified"}`),
          node("div", { class: "code-target" }, ids.length ? ids.map(id => `${id} · ${manifest.targets[id]?.name || "Target name not supplied"}`).join(" | ") : "No resolved target ID"),
          ...(flags ? [node("div", {}, `Review flags: ${careFlagLabels(manifest, flags).join("; ")}`)] : []));
      });
    };
    const change = (key, value) => { state[key] = value; update(); };
    const filters = node("div", { class: "filters" },
      ui.searchBox("Code, organisation / department name or recorded target", state.query, value => change("query", value)),
      ui.filter("Mapping method", manifest.methods.filter((_, index) => rows.some(row => row[2] === index)), state.method, value => change("method", value)),
      ui.filter("Review flag", manifest.flags, state.flag, value => change("flag", value)));
    if (category !== "visittypes") filters.append(ui.filter("Human verification", ["Human verified", "Not human verified"], state.verification, value => change("verification", value)));
    view.append(node("section", {}, node("h2", {}, `${manifest.categories[category]} · ${backlog ? "Suggest new mappings" : "Review mappings"}`),
      node("p", {}, category === "sor" ? "Manual, rule-based and LLM classifications retain their recorded origin. A resolved target ID does not mean human approval. Search covers codes, names and recorded targets; open a record for its classification justification." :
        category === "legacy" ? "Historical SHAK / department mappings are separate from SOR organisations. Only explicitly approved Usagi rows are identified as manual; other origins are unspecified. Scientific-notation source values are preserved for review." :
          "This is an OMOP place-of-service to Visit concept crosswalk, not a Danish organisation mapping. Repeated or conflicting recorded rows are retained; no downstream Visit type is selected automatically."),
      ...(backlog && !manifest.stats[category].unresolved ? [node("p", {}, "These files contain no source rows without a positive target. Unreviewed mappings remain under Review mappings.")] : []),
      ...(backlog && category === "visittypes" ? [node("p", {}, "These concepts are used as targets in the supplied care-site mappings but have no downstream Visit mapping in the crosswalk. Their original care-site classifications still require review.")] : []),
      filters, download, results));
    update();
  }
  async function render({ route, category, mode, commit, key, hash }) {
    await loadManifest();
    if (route === "caresites") {
      if (!Object.hasOwn(manifest.categories, category)) category = "sor";
      const index = mode === "bulk" ? null : await read(manifest.indexes[category]);
      if (ui.getHash() !== hash) return;
      return list(category, mode || "review", index?.rows);
    }
    if (commit !== manifest.commit) {
      if (ui.getHash() === hash) view.append(node("p", {}, "This link refers to a different care-site snapshot."));
      return;
    }
    key = decodeURIComponent(key || "");
    if (!Object.keys(manifest.categories).some(value => key.startsWith(value + "-")) || key.length > 140) throw new Error("Unknown care-site source.");
    const group = await read(careDetailFile(manifest, key));
    if (ui.getHash() !== hash) return;
    const source = Object.hasOwn(group.sources, key) && group.sources[key];
    if (!source) { view.append(node("p", {}, "Unknown care-site source.")); return; }
    const catalog = { ...manifest, sources: { [key]: source }, mappings: group.mappings.filter(row => row.sourceKey === key), unmapped: [],
      targets: Object.fromEntries(Object.entries(manifest.targets).filter(([, target]) => source.category === "visittypes" ? target.domain === "Visit" : target.domain !== "Visit")) };
    const edit = route === "care-site-propose";
    ui.showGrouped(key, commit, edit, { data: catalog, details: new Map([[key, source]]), route: "care-site", dataset: "caresites",
      navigation: () => {
        navigation(source.category);
        view.append(node("p", {}, source.category === "visittypes" ? "Changes here propose a different downstream Visit concept for a place-of-service concept." :
          "Changes here propose the organisation or department's place-of-service target. Use Visit type crosswalk to review downstream Visit concepts."));
      } });
    view.append(facts("Mapping provenance", [["Mapping method", source.method], ["Verified by", source.verifiedBy || "No human verification recorded"],
      ["Classification file", source.classificationFile], ["Classification record", source.classificationRow],
      ["Source reference file", source.referenceFile], ["Source reference record", source.referenceRow],
      ["Rule details", source.methodIndex === 1 ? "Keyword rule; the specific keyword is not recorded" : ""]]),
      ...(source.justification ? [node("section", {}, node("h3", {}, "Recorded LLM justification"), node("p", {}, source.justification))] : []),
      ...(source.flags ? [node("section", {}, node("h3", {}, "Review flags"), node("ul", {}, ...careFlagLabels(manifest, source.flags).map(label => node("li", {}, label))))] : []));
    if (source.category === "sor") {
      const derived = catalog.mappings.flatMap(row => (manifest.crosswalk[row.conceptId] || []).map(record => ({ ...record, place: row.conceptId })));
      view.append(node("section", { class: "tone-target" }, node("h3", {}, "Recorded classification and downstream Visit mappings"),
        node("p", {}, `Recorded predicted category: ${source.predictedCategory || "Not supplied"}`),
        node("p", {}, "The place-of-service target above and the Visit concept below are distinct. Conflicting crosswalk rows are shown as recorded and require review."),
        derived.length ? bulkTable(["Place-of-service ID", "Recorded crosswalk label", "Visit concept ID", "Crosswalk record"], derived.map(row => [
          link(row.place, `https://athena.ohdsi.org/search-terms/terms/${row.place}`), row.name,
          link(row.conceptId, `https://athena.ohdsi.org/search-terms/terms/${row.conceptId}`), row.sourceRow,
        ])) : node("p", {}, "No downstream Visit mapping recorded for this target.")));
    }
    if (source.locations?.length) view.append(node("section", { class: "tone-source" }, node("h3", {}, "Supporting SHAK hospital history"),
      node("p", {}, source.locationMatch), ...source.locations.map(row => facts("Hospital record", Object.entries(row), "source"))));
  }
  return { render, loadManifest, get manifest() { return manifest; } };
}
