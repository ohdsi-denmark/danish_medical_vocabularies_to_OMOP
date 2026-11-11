export const batchLimit = 10;

export const procedureRelationships = {
  unspecified: "Unspecified",
  components: "Complementary components",
  alternatives: "Alternatives depending on context",
};

export function procedureProposal(data, input) {
  if (input.commit !== data.commit) throw new Error("The mappings have been updated. Reload before submitting.");
  const condition = input.dataset === "conditions";
  const care = input.dataset === "caresites";
  const { code, changes, relationship, reason } = (care ? input.caresite : condition ? input.condition : input.procedure) || {};
  if (!Object.hasOwn(data.sources, code)) throw new Error("Choose a known SKS source code.");
  if (!Array.isArray(changes) || !changes.length || changes.length > batchLimit) {
    throw new Error(`Propose between 1 and ${batchLimit} changes.`);
  }
  if (!Object.hasOwn(procedureRelationships, relationship)) throw new Error("Choose how the targets relate.");
  const justification = typeof reason === "string" ? reason.trim() : "";
  if (justification.length < 10 || justification.length > 1500) throw new Error("Give a justification of 10 to 1,500 characters.");

  const current = data.mappings.filter(row => row.sourceKey === code);
  const records = new Map(current.map(row => [row.id, row]));
  const edited = new Set();
  const edits = changes.map(change => {
    if (!change || !["add", "replace", "remove"].includes(change.action)) throw new Error("Choose a valid change.");
    const row = records.get(change.mapping);
    if (change.action !== "add") {
      if (!row || edited.has(row.id)) throw new Error("Choose a distinct mapping record for this source code.");
      edited.add(row.id);
    }
    if (change.action !== "remove" && (typeof change.target !== "string" || !/^[1-9]\d{0,9}$/.test(change.target))) {
      throw new Error("Enter a positive OMOP concept ID for each added or replaced target.");
    }
    if (change.action === "replace" && change.target === row.conceptId) throw new Error("Choose a different replacement target.");
    return { action: change.action, row, target: change.target };
  }).sort((a, b) => (a.row?.id || "").localeCompare(b.row?.id || "") || (a.target || "").localeCompare(b.target || ""));

  const resulting = new Set(current.filter(row => !edited.has(row.id) && /^[1-9]\d*$/.test(row.conceptId)).map(row => row.conceptId));
  for (const edit of edits) {
    if (edit.action === "remove") continue;
    if (resulting.has(edit.target)) throw new Error(`OMOP concept ${edit.target} is already in the proposed target set.`);
    resulting.add(edit.target);
  }
  const safe = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("@", "&#64;");
  const targetLink = id => /^[1-9]\d*$/.test(id) ? `[${id}](https://athena.ohdsi.org/search-terms/terms/${id})` : "No usable target";
  const source = data.sources[code];
  const displayCode = source.code || code;
  const body = [
    `Source: ${safe(displayCode)} · ${safe(source.name)}`,
    `Mapping snapshot: \`${data.commit}\``,
    ...(care ? [
      `Care-site source system: ${safe(data.categories[source.category])}`,
      `Proposed mapping file: ${safe(data.mappingFiles[source.category])}`,
      `Recorded mapping origin: ${safe(source.method)}`,
      ...(source.verifiedBy ? [`Verified by: ${safe(source.verifiedBy)}`] : []),
      ...(source.predictedCategory ? [`Recorded predicted category: ${safe(source.predictedCategory)}`] : []),
      ...(source.classificationFile ? [`Classification record: ${safe(source.classificationRow)} in ${safe(source.classificationFile)}`] : []),
      ...(source.referenceFile ? [`Observed source reference: record ${safe(source.referenceRow)} in ${safe(source.referenceFile)}`] : []),
      ...(source.justification ? [`Recorded classification justification:\n${safe(source.justification).split(/\r?\n/).map(line => `> ${line}`).join("\n")}`] : []),
      `Review flags: ${(data.flags || []).filter((_, index) => source.flags & (1 << index)).map(safe).join("; ") || "None recorded"}`,
    ] : [`SKS catalogue: ${data.release.release}, eligibility checked on ${data.release.asOf}`]),
    ...(data.coverageNote ? [data.coverageNote] : []),
    ...(condition ? ["### Supplied standard reference targets", ...(data.referenceTargets[code] || []).map(([id, name, vocabulary]) =>
      `- ${targetLink(id)} ${safe(name)} · ${safe(vocabulary)}`), "Changes below apply to the Danish custom mapping file; reference targets are context for reviewing an override."] : []),
    "### Current mapping records",
    current.length ? current.map(row => `- ${targetLink(row.conceptId)} ${safe(row.conceptName)} · ${safe(row.domainId || "Domain not supplied")} · ${safe(row.mappingStatus)}${care ? ` · ${safe(row.method)}` : ""} · record ${row.sourceRow} in ${row.sourceFile}`).join("\n") : "No current mapping records.",
    "### Proposed edits",
    edits.map(({ action, row, target }) => {
      if (action === "add") return `- Add ${targetLink(target)}`;
      const record = `record ${row.sourceRow} (${targetLink(row.conceptId)})`;
      return action === "remove" ? `- Remove ${record}` : `- Replace ${record} with ${targetLink(target)}`;
    }).join("\n"),
    `Proposed ${condition ? "custom " : ""}target set: ${[...resulting].map(targetLink).join(", ") || "Empty"}`,
    `Relationship between targets: ${procedureRelationships[relationship]}`,
    "### Justification",
    safe(justification).split(/\r?\n/).map(line => `> ${line}`).join("\n"),
  ].join("\n\n");
  return { title: `${care ? "Care-site" : condition ? "Condition" : "Procedure"} mapping proposal for ${displayCode}`, body };
}

export function proposal(data, input) {
  if (input?.commit !== data.commit) throw new Error("The mappings have been updated. Reload before submitting.");
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > batchLimit) {
    throw new Error("Select between 1 and 10 codes.");
  }
  const seen = new Set();
  const rows = input.rows.map(row => {
    const current = row?.mapping ? data.mappings.find(mapping => mapping.id === row.mapping) : null;
    const source = data.sources?.[current?.sourceKey || row?.item];
    const unmapped = data.sources
      ? data.unmapped.some(item => item.id === row?.item && item.code === row?.code)
      : data.unmapped.some(item => item.code === row?.code);
    if (!row || (row.mapping ? !current || current.sourceCode !== row.code : !unmapped) ||
        (data.sources && (!source || source.code !== row.code || (row.item && source.id !== row.item)))) {
      throw new Error("A source code or mapping could not be found.");
    }
    const identity = source?.id || row.code;
    if (seen.has(identity)) throw new Error("Include each source item only once.");
    seen.add(identity);
    const target = typeof row.target === "string" ? row.target.trim() : "";
    const reason = typeof row.reason === "string" ? row.reason.trim() : "";
    if (!/^[1-9]\d{0,9}$/.test(target)) throw new Error("Enter a positive OMOP concept ID for every code.");
    if (current?.conceptId === target && current.reviewState !== "Needs review") {
      throw new Error("Choose a target different from the current mapping.");
    }
    if (reason.length < 10 || reason.length > 1500) throw new Error("Give each proposal a justification of 10 to 1,500 characters.");
    return { code: row.code, mapping: current?.id ?? "", current, source, target, reason };
  }).sort((a, b) => a.code.localeCompare(b.code) || (a.source?.id || "").localeCompare(b.source?.id || ""));

  const safe = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("@", "&#64;");
  const title = rows.length === 1
    ? `Mapping proposal for ${rows[0].code}`
    : `Mapping proposals for ${rows.length} source items`;
  const body = [
    "Submitted via the Danish OMOP Mapping Explorer.",
    `Mapping snapshot: \`${data.commit}\``,
    ...rows.map(({ code, mapping, current, source, target, reason }) => {
      return [
        `### ${safe(code)}`,
        ...(source ? [
          `Category: ${safe(data.categories[source.category])}`,
          `Source item: ${source.id}`,
          `Source name: ${safe(source.name)}`,
          ...(source.preparation ? [`Preparation: ${safe(source.preparation)}`] : []),
        ] : []),
        current ? `${current.reviewState === "Needs review" ? "Existing proposal" : "Current target"}: ${safe(current.conceptId || "None")} ${safe(current.conceptName)} (mapping ${mapping})` :
          source ? "Current target: No usable published mapping identified in this collection's source files." : "Current target: Unmapped in the published NPU report",
        ...(current?.sourceFile ? [`Mapping file: ${safe(current.sourceFile)}; data record ${current.sourceRow}`] : []),
        ...(current?.recordedTarget && current.recordedTarget !== current.conceptId ?
          [`Original target field: ${safe(current.recordedTarget)}`] : []),
        `Proposed target: [${target}](https://athena.ohdsi.org/search-terms/terms/${target})`,
        "Target needs verification against the OMOP vocabulary.",
        "",
        "Justification",
        "",
        ...safe(reason).split(/\r?\n/).map(line => `> ${line}`),
      ].join("\n");
    }),
  ].join("\n\n");
  return { title, body };
}
