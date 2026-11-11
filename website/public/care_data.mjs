import { bulkLimit } from "./bulk.mjs";

const files = { sor: "SOR_to_visit_concept.csv", legacy: "sor_to_nucc_USAGI.csv", visittypes: "care_site_to_visit_type_map.csv" };

export function careKey(category, code) { return `${category}-${code}`; }

export function careBucket(key, count = 1024) {
  let value = 2166136261;
  for (const byte of new TextEncoder().encode(key)) value = Math.imul(value ^ byte, 16777619) >>> 0;
  return value % count;
}

export function careDetailFile(manifest, key) {
  return `${manifest.assetRoot}/details/${careBucket(key, manifest.shardCount).toString(16).padStart(3, "0")}.json`;
}

export function careFlagLabels(manifest, bits) {
  return manifest.flags.filter((_, index) => bits & (1 << index));
}

export function careSummary(manifest, category, rows, codes) {
  if (!Object.hasOwn(manifest.categories, category)) throw new Error("Choose a care-site category.");
  const sources = {};
  const mappings = [];
  const unmapped = [];
  for (const [code, name, methodIndex, records, flags] of rows) {
    if (codes && !codes.has(code)) continue;
    const key = careKey(category, code);
    const method = manifest.methods[methodIndex];
    sources[key] = { id: key, code, name, category, method, flags, proposalFile: files[category],
      details: [{ "Mapping method": method, "Review flags": careFlagLabels(manifest, flags).join(" | ") }] };
    for (const [number, conceptId, mappingStatus, recordMethod] of records) mappings.push({
      id: `${category}-row-${number}`, sourceKey: key, sourceCode: code, sourceName: name, category, conceptId,
      conceptName: manifest.targets[conceptId]?.name || "Target name not supplied", sourceFile: files[category], sourceRow: number,
      method: recordMethod, mappingStatus, reviewState: "Published",
    });
    if (!records.length) unmapped.push({ id: key, code, sourceKey: key, category });
  }
  return { ...manifest, sources, mappings, unmapped };
}

export async function careSubmissionData(manifest, input, load) {
  if (input.commit !== manifest.commit) throw new Error("The mappings have been updated. Reload before submitting.");
  if (input.bulk !== undefined) {
    const { category, rows } = input.bulk || {};
    if (!Object.hasOwn(manifest.categories, category) || !Array.isArray(rows) || !rows.length || rows.length > bulkLimit) {
      throw new Error("Choose a care-site type and 1 to 250 changes.");
    }
    if (rows.some(row => typeof row?.code !== "string" || row.code.length > 120)) throw new Error("Choose known care-site source codes.");
    const codes = new Set(rows.map(row => row.code));
    const buckets = [...new Set([...codes].map(code => careBucket(careKey(category, code), manifest.validationShards)))];
    const selected = [];
    // Bounded groups avoid parsing the full SOR index inside the submission Worker.
    for (let start = 0; start < buckets.length; start += 4) await Promise.all(buckets.slice(start, start + 4).map(async bucket => {
      const index = await load(`${manifest.assetRoot}/validation/${category}/${bucket.toString(16).padStart(2, "0")}.json`);
      if (index.commit !== manifest.commit || !Array.isArray(index.rows)) throw new Error("Care-site index refers to a different snapshot.");
      selected.push(...index.rows.filter(row => codes.has(row[0])));
    }));
    return careSummary(manifest, category, selected, codes);
  }
  const key = input.caresite?.code;
  if (typeof key !== "string" || key.length > 140 || !Object.keys(manifest.categories).some(category => key.startsWith(category + "-"))) {
    throw new Error("Choose a known care-site source.");
  }
  const group = await load(careDetailFile(manifest, key));
  if (group.commit !== manifest.commit || !Object.hasOwn(group.sources || {}, key)) throw new Error("Unknown care site or stale snapshot.");
  return { ...manifest, sources: { [key]: group.sources[key] }, mappings: group.mappings.filter(row => row.sourceKey === key), unmapped: [] };
}
