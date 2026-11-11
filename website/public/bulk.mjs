export const bulkLimit = 250;
export const bulkFileLimit = 16 * 1024 * 1024;

export const bulkTypes = {
  npu: "NPU measurements", dnk: "DNK measurements", products: "Medication products",
  ingredients: "Medication ingredients", vaccines: "Vaccines", routes: "Administration routes", procedures: "Procedure codes",
};

export function detectDelimiter(text) {
  const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (const char of text.replace(/^\s*\n/, "")) {
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "\r" || char === "\n") break;
    if (counts.has(char)) counts.set(char, counts.get(char) + 1);
  }
  const [delimiter, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return count ? delimiter : " ";
}

export function parseBulkText(text, delimiter) {
  if (![",", ";", "\t", " "].includes(delimiter) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw new Error("Choose a plain-text CSV, TSV or TXT file.");
  }
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const finishField = () => { row.push(field.trim()); field = ""; closed = false; };
  const finishRow = () => {
    if (delimiter !== " " || field || closed) finishField();
    if (row.some(Boolean)) rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') { field += '"'; index++; }
      else { quoted = false; closed = true; }
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      finishRow();
    } else if (char === delimiter) {
      if (delimiter !== " " || field || closed) finishField();
    } else if (char === '"' && !field.trim() && !closed) {
      field = "";
      quoted = true;
    } else {
      if (closed && char.trim()) throw new Error("Check the delimiter and quotation marks in the file.");
      if (!closed) field += char;
    }
  }
  if (quoted) throw new Error("The file contains an unclosed quotation mark.");
  finishRow();
  if (!rows.length || rows[0].length < 2) throw new Error("The first row must contain at least two columns.");
  return rows;
}

export function bulkIndex(data, type) {
  const index = new Map();
  const add = (code, row) => {
    if (!index.has(code)) index.set(code, []);
    index.get(code).push(row);
  };
  for (const row of data.mappings) {
    const belongs = row.category ? row.category === type && row.reviewState === "Published" :
      row.vocabulary.toLowerCase() === type;
    if (!belongs || !/^[1-9]\d{0,9}$/.test(row.conceptId)) continue;
    const codes = new Set([row.sourceCode]);
    if (type === "products") codes.add(row.sourceCode.replace(/^Drug /, ""));
    if (type === "ingredients") codes.add(row.sourceCode.replace(/^Ingredient /, ""));
    for (const code of codes) add(code, row);
  }
  for (const item of data.unmapped) {
    if ((item.category || "npu") !== type) continue;
    const source = data.sources?.[item.sourceKey];
    const entry = { id: item.id || `unmapped-${item.code}`, sourceCode: item.code,
      sourceName: source?.name, preparation: source?.preparation, unmapped: true };
    add(item.code, entry);
    const prefix = type === "products" ? "Drug " : type === "ingredients" ? "Ingredient " : "";
    if (prefix && item.code.startsWith(prefix)) add(item.code.slice(prefix.length), entry);
  }
  return index;
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^\s*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function unmappedCsv(data, items) {
  const routeMappings = new Map();
  for (const row of data.mappings) {
    if (row.category !== "routes") continue;
    if (!routeMappings.has(row.sourceKey)) routeMappings.set(row.sourceKey, []);
    routeMappings.get(row.sourceKey).push(row);
  }
  const columns = new Set(["source_code", "source_item_id"]);
  const records = items.map(item => {
    const fields = new Map();
    const add = (details, prefix = "") => {
      for (const [key, value] of Object.entries(details || {})) {
        if (value == null || value === "") continue;
        const column = prefix + key;
        columns.add(column);
        if (!fields.has(column)) fields.set(column, new Set());
        fields.get(column).add(value);
      }
    };
    add({ source_code: item.code, source_item_id: item.id || `unmapped-${item.code}`,
      source_frequency: item.occurrences, mapping_snapshot: data.commit });
    const terminology = data.sourceDetails?.[item.code];
    add(terminology?.concept);
    for (const name of terminology?.names || []) add(name, "National name · ");
    for (const unit of data.units?.[item.code] || []) add(unit, "Unit mapping · ");
    const source = data.sources?.[item.sourceKey];
    if (source) {
      add({ source_name: source.name, preparation: source.preparation, backlog_reason: source.backlogReason,
        reference_file: source.referenceFile });
      const details = source.detailIds ? source.detailIds.map(id => data.referenceRecords[id]) : source.details;
      for (const detail of details || []) add(detail);
      for (const id of source.supportIds || []) {
        const support = data.supportRecords[id];
        add(support.fields, `${support.file} · `);
      }
      for (const row of routeMappings.get(item.sourceKey) || []) {
        add({ route_abbreviation: row.abbreviation, route_note: row.comment, recorded_target: row.recordedTarget,
          recorded_target_name: row.conceptName, source_file: row.sourceFile, source_record: row.sourceRow });
      }
    }
    return fields;
  });
  const headers = [...columns, "OMOP_concept_id"];
  return "\uFEFF" + [headers, ...records.map(record => headers.map(key => [...(record.get(key) || [])].join(" | ")))]
    .map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

export function bulkProposal(data, input) {
  if (input.commit !== data.commit) throw new Error("The mappings have been updated. Reload before submitting.");
  const { category, rows, reason } = input.bulk || {};
  if (!Object.hasOwn(bulkTypes, category)) throw new Error("Choose a mapping type.");
  if (!Array.isArray(rows) || !rows.length || rows.length > bulkLimit) {
    throw new Error(`Upload between 1 and ${bulkLimit} mapping changes.`);
  }
  const justification = typeof reason === "string" ? reason.trim() : "";
  if (justification.length < 10 || justification.length > 1500) {
    throw new Error("Give a justification of 10 to 1,500 characters for the bulk change.");
  }
  const index = bulkIndex(data, category);
  const seen = new Set();
  const records = rows.map((row, offset) => {
    const candidates = index.get(row?.code) || [];
    const current = row?.mapping ? candidates.find(item => item.id === row.mapping) :
      candidates.length === 1 ? candidates[0] : undefined;
    const label = `Data row ${offset + 1}`;
    if (!current) throw new Error(`${label}: choose a mapping or unmapped source record for this code.`);
    if (seen.has(current.id)) throw new Error(`${label}: record ${current.id} is listed more than once.`);
    seen.add(current.id);
    if (typeof row.target !== "string" || !/^[1-9]\d{0,9}$/.test(row.target)) {
      throw new Error(`${label}: enter a positive OMOP concept ID.`);
    }
    if (row.target === current.conceptId) throw new Error(`${label}: the proposed target matches the current target.`);
    return { current, target: row.target };
  }).sort((a, b) => a.current.id.localeCompare(b.current.id));

  const columns = ["source_code", "current_omop_concept_id", "proposed_omop_concept_id", "mapping_id",
    "source_name", "preparation", "source_file", "source_record"];
  const csv = [columns, ...records.map(({ current, target }) => [
    current.sourceCode, current.conceptId, target, current.id, current.sourceName, current.preparation,
    current.sourceFile, current.sourceRow,
  ])].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  if (new TextEncoder().encode(csv).length > 256 * 1024) throw new Error("The prepared CSV is too large. Split the changes into smaller files.");
  const safeReason = justification.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("@", "&#64;");
  const title = `Bulk mapping proposal for ${bulkTypes[category]} (${records.length} ${records.length === 1 ? "change" : "changes"})`;
  const body = [
    "Submitted via the Danish OMOP Mapping Explorer.",
    `Mapping snapshot: \`${data.commit}\``,
    `Mapping type: ${bulkTypes[category]}`,
    `Proposed changes: ${records.length}`,
    ...(records.some(({ current }) => current.unmapped) ?
      [`New mappings: ${records.filter(({ current }) => current.unmapped).length}`] : []),
    "Verify proposed targets against the OMOP vocabulary before accepting changes.",
    "Justification",
    safeReason.split(/\r?\n/).map(line => `> ${line}`).join("\n"),
  ].join("\n\n");
  return { title, body, csv, records };
}
