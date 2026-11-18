const number = value => value.toLocaleString("en-GB");

export function coverageLabel(row) {
  if (!row.total) return "Not available";
  if (row.percentage > 0 && row.percentage < 0.1) return "<0.1%";
  if (row.percentage < 100 && row.percentage > 99.9) return ">99.9%";
  return row.percentage.toLocaleString("en-GB", { maximumFractionDigits: 1 }) + "%";
}

export function renderDashboard({ node, link, view }, report) {
  const topicNames = Object.fromEntries(report.topics.map(topic => [topic.id, topic.label]));
  const meter = row => row.total ? node("div", { class: "coverage-meter", role: "meter", "aria-label": row.label,
    "aria-valuemin": 0, "aria-valuemax": row.total, "aria-valuenow": row.mapped,
    "aria-valuetext": `${number(row.mapped)} of ${number(row.total)} mapped (${coverageLabel(row)})` },
    node("span", { style: `width: ${row.percentage}%` })) : node("span", { class: "dashboard-muted" }, "No source inventory");
  const cards = node("div", { class: "dashboard-cards" }, ...report.topics.map(topic =>
    node("article", { class: "dashboard-card" }, node("h3", {}, link(topic.label, topic.href)),
      node("p", { class: "dashboard-percentage" }, coverageLabel(topic)), meter(topic),
      node("dl", { class: "dashboard-counts" }, ...[["Mapped", topic.mapped], ["Without target", topic.unmapped], ["Known total", topic.total]].map(([label, value]) =>
        node("div", {}, node("dt", {}, label), node("dd", {}, number(value))))),
      node("p", { class: "dashboard-muted" }, topic.note))));

  let selected = "";
  const mappingTables = node("div", { class: "dashboard-table" });
  const sourceTables = node("div", { class: "dashboard-table" });
  const sourceSection = node("section", {}, node("h3", {}, "DNPR source tables"),
    node("p", {}, "These counts use the procedure and diagnosis reports you supplied. A code can occur in several tables; these rows overlap and should not be added together. Frequencies are not used to weight the percentages."), sourceTables);
  const table = (rows, files) => node("table", {},
    node("thead", {}, node("tr", {}, ...["Topic / table", "Mapped", "Without target", "Known total", "Mapped %", "Inventory covered"].map(label => node("th", { scope: "col" }, label)))),
    node("tbody", {}, ...rows.map(row => node("tr", {},
      node("th", { scope: "row" }, node("small", { class: "dashboard-topic" }, topicNames[row.topic]), link(row.label, row.href),
        ...(row.unit !== "codes" ? [node("small", {}, `Counted as ${row.unit}`)] : []),
        ...(row.suggestHref ? [link("Suggest mappings →", row.suggestHref)] : [])),
      ...[row.mapped, row.unmapped, row.total].map(value => node("td", { class: "dashboard-number" }, number(value))),
      node("td", { class: "dashboard-coverage" }, node("strong", {}, coverageLabel(row)), meter(row)),
      node("td", { class: "dashboard-scope" }, row.scope,
        ...(row.includedInTopic === false ? [node("p", { class: "dashboard-muted" }, "Not added to the topic total.")] : []),
        ...(row.humanVerified != null && row.id !== "care-visittypes" ? [node("p", {}, `${number(row.humanVerified)} with recorded human verification.`)] : []),
        ...(row.pendingReview ? [node("p", {}, `${number(row.pendingReview)} without a published target have pending proposals; see `, link("Review mappings", row.href), ".")] : []),
        ...(files ? [node("details", {}, node("summary", {}, "Source files"), node("ul", {}, ...row.files.map(file => node("li", {}, file))))] : []))))));
  const update = () => {
    const rows = report.tables.filter(row => !selected || row.topic === selected);
    const sources = report.sourceTables.filter(row => !selected || row.topic === selected);
    mappingTables.replaceChildren(table(rows, true));
    sourceTables.replaceChildren(table(sources, false));
    sourceSection.hidden = !sources.length;
  };
  const select = node("select", { "aria-label": "Filter dashboard by topic", onchange: event => { selected = event.target.value; update(); } },
    node("option", { value: "" }, "All topics"), ...report.topics.map(topic => node("option", { value: topic.id }, topic.label)));
  view.append(node("section", { class: "dashboard-intro" }, node("h2", {}, "Mapping coverage"),
    node("p", {}, "How many of the supplied source codes have a recorded OMOP target?"),
    node("p", {}, report.definition)), cards,
    node("section", {}, node("div", { class: "dashboard-table-heading" }, node("h3", {}, "Coverage by mapping table"), node("label", {}, "Topic", select)),
      node("p", {}, report.countingNote), mappingTables), sourceSection);
  update();
}
