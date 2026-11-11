// Expand the compact transport index for the existing search and proposal helpers.
export function expandProcedures(data) {
  if (!data.sourceRows) return data;
  const { sourceRows, ...catalog } = data;
  catalog.sources = Object.fromEntries(sourceRows.map(([code, name, occurrences, currentOperation, searchText], index) => [code, {
    id: code, code, name, category: data.sourceCategory || "procedures", occurrences, currentOperation, searchText,
    detailFile: `${data.detailRoot}/${String(Math.floor(index / data.detailChunkSize)).padStart(3, "0")}.json`,
  }]));
  return catalog;
}
