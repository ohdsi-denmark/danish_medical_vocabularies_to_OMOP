const number = value => value.toLocaleString("en-GB");

export function coverageLabel(row) {
  if (!row.total) return "Not available";
  if (row.percentage > 0 && row.percentage < 0.1) return "<0.1%";
  if (row.percentage < 100 && row.percentage > 99.9) return ">99.9%";
  return row.percentage.toLocaleString("en-GB", { maximumFractionDigits: 1 }) + "%";
}

export function renderDashboard({ node, link, view }, report) {
  const topicNames = Object.fromEntries(report.topics.map(topic => [topic.id, topic.label]));
  let tooltipId = 0;
  const caveat = content => {
    const id = `dashboard-caveat-${++tooltipId}`;
    const tooltip = node("span", { id, role: "tooltip", class: "dashboard-tooltip" }, content);
    let pinned = false;
    let wrapper;
    const position = () => {
      const viewport = trigger.ownerDocument?.defaultView;
      if (!viewport) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(448, viewport.innerWidth - 32);
      const left = Math.max(16, Math.min(rect.left, viewport.innerWidth - width - 16));
      const below = viewport.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const placeBelow = below >= Math.min(tooltip.scrollHeight, 320) || below >= above;
      const height = Math.max(48, Math.min(320, placeBelow ? below : above));
      tooltip.setAttribute("style", `width:${width}px;left:${left}px;max-height:${height}px;top:${placeBelow ? rect.bottom : Math.max(16, rect.top - Math.min(tooltip.scrollHeight, height))}px`);
    };
    const open = () => { wrapper.setAttribute("data-dismissed", "false"); position(); };
    const close = () => { pinned = false; wrapper.setAttribute("data-open", "false"); wrapper.setAttribute("data-dismissed", "true"); };
    const trigger = node("button", { type: "button", class: "dashboard-caveat-trigger", "aria-describedby": id,
      onfocus: open, onclick: () => {
        pinned = !pinned;
        wrapper.setAttribute("data-open", String(pinned));
        wrapper.setAttribute("data-dismissed", String(!pinned));
        position();
      },
    }, "caveats limitations");
    wrapper = node("span", { class: "dashboard-caveat", onpointerenter: open, onfocusout: close,
      onkeydown: event => { if (event.key === "Escape") close(); },
    }, trigger, tooltip);
    return wrapper;
  };
  const descriptions = {
    measurements: "NPU and DNK measurement codes.", drugs: "Medications, vaccines and administration routes.",
    procedures: "Danish procedure codes.", conditions: "Danish diagnosis codes.", caresites: "Organisations and departments.",
  };
  const meter = row => row.total ? node("div", { class: "coverage-meter", role: "meter", "aria-label": row.label,
    "aria-valuemin": 0, "aria-valuemax": row.total, "aria-valuenow": row.mapped,
    "aria-valuetext": `${number(row.mapped)} of ${number(row.total)} mapped (${coverageLabel(row)})` },
    node("span", { style: `width: ${row.percentage}%` })) : node("span", { class: "dashboard-muted" }, "No source inventory");
  const cards = node("div", { class: "dashboard-cards" }, ...report.topics.map(topic =>
    node("article", { class: "dashboard-card" }, node("h3", {}, link(topic.label, topic.href)),
      node("p", { class: "dashboard-percentage" }, coverageLabel(topic)), meter(topic),
      node("dl", { class: "dashboard-counts" }, ...[["Mapped", topic.mapped], ["Without target", topic.unmapped], ["Known total", topic.total]].map(([label, value]) =>
        node("div", {}, node("dt", {}, label), node("dd", {}, number(value))))),
      node("p", { class: "dashboard-muted" }, descriptions[topic.id] || topic.label),
      caveat([topic.note, ...report.tables.filter(row => row.topic === topic.id && row.includedInTopic).map(row => `${row.label}: ${row.scope}`)].join("\n\n")))));

  let selected = "";
  const mappingTables = node("div", { class: "dashboard-table" });
  const sourceTables = node("div", { class: "dashboard-table" });
  const sourceSection = node("section", {}, node("h3", {}, "DNPR source tables"),
    node("p", {}, "Procedure and diagnosis mapping coverage by DNPR table, based on the November 2024 extract."),
    caveat("A code can occur in several tables; these rows overlap and should not be added together. Frequencies are not used to weight the percentages."), sourceTables);
  const table = (rows, files) => node("table", {},
    node("thead", {}, node("tr", {}, ...["Topic / table", "Mapped", "Without target", "Known total", "Mapped %", "Details"].map(label => node("th", { scope: "col" }, label)))),
    node("tbody", {}, ...rows.map(row => node("tr", {},
      node("th", { scope: "row" }, node("small", { class: "dashboard-topic" }, topicNames[row.topic]), link(row.label, row.href),
        ...(row.unit !== "codes" ? [node("small", {}, row.unit)] : []),
        ...(row.suggestHref ? [link("Suggest mappings →", row.suggestHref)] : [])),
      ...[row.mapped, row.unmapped, row.total].map(value => node("td", { class: "dashboard-number" }, number(value))),
      node("td", { class: "dashboard-coverage" }, node("strong", {}, coverageLabel(row)), meter(row)),
      node("td", { class: "dashboard-scope" }, caveat([row.scope,
        ...(row.includedInTopic === false ? ["Not added to the topic total."] : []),
        ...(row.humanVerified != null && row.id !== "care-visittypes" ? [`${number(row.humanVerified)} with recorded human verification.`] : []),
        ...(row.pendingReview ? [`${number(row.pendingReview)} without a published target have pending proposals; see Review mappings.`] : []),
      ].join("\n\n")),
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
    node("p", {}, "Mapped code counts and coverage by topic and table."), caveat(report.definition)), cards,
    node("section", {}, node("div", { class: "dashboard-table-heading" }, node("h3", {}, "Coverage by mapping table"), node("label", {}, "Topic", select)),
      node("p", {}, "Codes with and without recorded mappings, grouped by mapping table."), caveat(report.countingNote), mappingTables), sourceSection);
  update();
}
