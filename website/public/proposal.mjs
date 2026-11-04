export const batchLimit = 10;

export function proposal(data, input) {
  if (input?.commit !== data.commit) throw new Error("The mappings have been updated. Reload before submitting.");
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > batchLimit) {
    throw new Error("Select between 1 and 10 codes.");
  }
  const seen = new Set();
  const rows = input.rows.map(row => {
    const current = row?.mapping ? data.mappings.find(mapping => mapping.id === row.mapping) : null;
    if (!row || (row.mapping ? current?.sourceCode !== row.code : !data.unmapped.some(item => item.code === row.code))) {
      throw new Error("A source code or mapping could not be found.");
    }
    if (seen.has(row.code)) throw new Error("Include each source code only once.");
    seen.add(row.code);
    const target = typeof row.target === "string" ? row.target.trim() : "";
    const reason = typeof row.reason === "string" ? row.reason.trim() : "";
    if (!/^[1-9]\d{0,9}$/.test(target)) throw new Error("Enter a positive OMOP concept ID for every code.");
    if (current?.conceptId === target) throw new Error("Choose a target different from the current mapping.");
    if (reason.length < 10 || reason.length > 1500) throw new Error("Give each proposal a justification of 10 to 1,500 characters.");
    return { code: row.code, mapping: current?.id ?? "", current, target, reason };
  }).sort((a, b) => a.code.localeCompare(b.code));

  const safe = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("@", "&#64;");
  const title = rows.length === 1
    ? `Mapping proposal for ${rows[0].code}`
    : `Mapping proposals for ${rows.length} lab codes`;
  const body = [
    "Submitted via the Danish OMOP Mapping Explorer.",
    `Mapping snapshot: \`${data.commit}\``,
    ...rows.map(({ code, mapping, current, target, reason }) => {
      const candidate = data.targets[target];
      return [
        `### ${code}`,
        current ? `Current target: ${safe(current.conceptId || "None")} ${safe(current.conceptName)} (mapping ${mapping})` : "Current target: Unmapped in the published NPU report",
        `Proposed target: [${target}](https://athena.ohdsi.org/search-terms/terms/${target})`,
        candidate?.standard ? `Vocabulary release: ${safe(data.omopRelease)}` : "Target needs verification against the OMOP vocabulary.",
        "",
        "Justification",
        "",
        ...safe(reason).split(/\r?\n/).map(line => `> ${line}`),
      ].join("\n");
    }),
  ].join("\n\n");
  return { title, body };
}
