export const batchLimit = 10;

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
