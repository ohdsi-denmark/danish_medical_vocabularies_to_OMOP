"""Mapping availability for distinct source identities, never counts of target rows."""
import csv
import json
from collections import defaultdict

from conditions import diagnosis_code, diagnosis_counts
from drugs import positive_id


def coverage(known, mapped):
    known, mapped = set(known), set(mapped)
    mapped &= known
    total, count = len(known), len(mapped)
    return dict(total=total, mapped=count, unmapped=total - count,
                percentage=100 * count / total if total else None)


def build_dashboard(root, out, labs, drugs, procedures, conditions, care):
    tables = []
    primary_sets = defaultdict(lambda: [set(), set()])

    def add(identifier, topic, label, known, mapped, files, scope, href, suggest=None, unit="codes", primary=True):
        known, mapped = set(known), set(mapped)
        row = dict(id=identifier, topic=topic, label=label, **coverage(known, mapped), files=files, scope=scope,
                   href=href, suggestHref=suggest, unit=unit, includedInTopic=primary)
        tables.append(row)
        if primary:
            primary_sets[topic][0].update((identifier, code) for code in known)
            primary_sets[topic][1].update((identifier, code) for code in mapped & known)
        return row

    for vocabulary in ("NPU", "DNK"):
        records = [row for row in labs["mappings"] if row["vocabulary"] == vocabulary]
        known = {row["sourceCode"] for row in records}
        if vocabulary == "NPU":
            known.update(row["code"] for row in labs["unmapped"])
        mapped = {row["sourceCode"] for row in records if positive_id(row["conceptId"])}
        add(vocabulary.lower(), "measurements", f"{vocabulary} measurements", known, mapped,
            ["Measurements (Labs)/" + ("NPU_mapping_USAGI.csv" if vocabulary == "NPU" else "NPU_mapping_99_USAGI (DNK).csv")] +
            (["Measurements (Labs)/missing_NPU_code__w_frequency.txt"] if vocabulary == "NPU" else []),
            "Mapping file and published NPU backlog" if vocabulary == "NPU" else "Mapping file only; no separate DNK unmapped inventory supplied",
            "#search", "#unmapped" if vocabulary == "NPU" else None)
    add("units", "measurements", "Related unit mappings", labs["units"],
        {code for code, rows in labs["units"].items() if any(positive_id(row["omop"]) for row in rows)},
        ["Measurements (Labs)/Units for NPU and DNK codes.csv"],
        "Lab codes with unit records; an auxiliary mapping, excluded from the topic total", "#search", unit="lab codes", primary=False)

    drug_files = {"products": "stcm_vnr.csv", "ingredients": "stcm_vnr.csv", "vaccines": "DDV_USAGI.csv", "routes": "route_map.csv"}
    for category, label in drugs["categories"].items():
        known = {key for key, source in drugs["sources"].items() if source["category"] == category}
        mapped = {row["sourceKey"] for row in drugs["mappings"]
                  if row["category"] == category and row["reviewState"] == "Published" and positive_id(row["conceptId"])}
        scope = "Supplied mapping and reference sources; pending proposals do not count as mapped"
        if category == "vaccines":
            scope += ". Each code/name/preparation identity is counted separately"
        row = add(category, "drugs", "Vaccine preparations" if category == "vaccines" else label, known, mapped,
            ["Drugs (Medications and Vaccines)/" + drug_files[category]], scope,
            f"#drugs/{category}/review", f"#drugs/{category}/unmapped",
            unit="preparations" if category == "vaccines" else "codes")
        row["pendingReview"] = len({record["sourceKey"] for record in drugs["mappings"]
                                    if record["category"] == category and record["reviewState"] == "Needs review"} - mapped)

    procedure_mapped = {row["sourceCode"] for row in procedures["mappings"] if positive_id(row["conceptId"])}
    add("procedures", "procedures", "SKS procedure codes", procedures["sources"], procedure_mapped,
        ["Procedures/NCSP_SKS_mappings.csv", "Procedures/procedure_source_code_counts.csv", "Procedures/sks_operations.json"],
        "Active reportable SKS operations, observed procedure codes and published historical mappings",
        "#procedures/review", "#procedures/unmapped")

    condition_custom = {row["sourceCode"] for row in conditions["mappings"]
                        if row["mappingStatus"] == "Published" and positive_id(row["conceptId"])}
    condition_standard = set(conditions["referenceCodes"])
    condition_mapped = condition_custom | condition_standard
    add("conditions", "conditions", "Danish diagnosis codes", conditions["sources"], condition_mapped,
        ["Conditions/stcm_dacICD10.csv", "Conditions/reference_data/icd10_standard_for_danish_codes.csv", "Procedures/diagnosis_source_code_counts.csv"],
        "Observed diagnoses and custom mapping codes; coverage includes exact matches in the supplied standard reference, whose vocabulary/release metadata is unavailable",
        "#conditions/review", "#conditions/unmapped")
    add("conditions-custom", "conditions", "Custom condition mapping file", {row["sourceCode"] for row in conditions["mappings"]}, condition_custom,
        ["Conditions/stcm_dacICD10.csv"], "Custom file only; overlaps the diagnosis inventory above and is excluded from the topic total",
        "#conditions/review", primary=False)
    add("conditions-standard", "conditions", "Standard condition reference file", condition_standard, condition_standard,
        ["Conditions/reference_data/icd10_standard_for_danish_codes.csv"],
        "Reference file only; overlaps the diagnosis inventory above and is excluded from the topic total",
        "#conditions/review", primary=False)

    for category, label in care["categories"].items():
        index = json.loads((out / care["indexes"][category]).read_text(encoding="utf-8"))["rows"]
        known = {row[0] for row in index}
        mapped = {row[0] for row in index if any(positive_id(record[1]) for record in row[3])}
        files = ["Caresites/" + care["mappingFiles"][category]]
        if category == "sor":
            files.insert(0, "Caresites/SOR_to_OMOP_visit_mappings_complete.csv")
        scope = {
            "sor": "Complete supplied SOR classification inventory; includes manual, rule-based and LLM targets",
            "legacy": "Legacy department mapping file only; unchecked targets count as recorded mappings",
            "visittypes": "Lookup concepts and care-site targets without a Visit mapping; auxiliary OMOP-to-OMOP mapping, excluded from the topic total",
        }[category]
        row = add("care-" + category, "caresites", "Visit type lookup" if category == "visittypes" else label, known, mapped,
                  files, scope, f"#caresites/{category}/review", f"#caresites/{category}/unmapped",
                  unit="OMOP concepts" if category == "visittypes" else "codes", primary=category != "visittypes")
        row["humanVerified"] = sum(row[2] == 0 and bool(row[3]) for row in index)

    source_tables = []
    procedure_tables = defaultdict(set)
    with (root / "Procedures/procedure_counts_by_table.csv").open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file, delimiter=";"):
            procedure_tables[row["Table"]].add(row["Code"].strip())
    for table, known in sorted(procedure_tables.items()):
        source_tables.append(dict(id="dnpr-" + table, topic="procedures", label=table,
            **coverage(known, procedure_mapped), unit="codes", href="#procedures/unmapped",
            scope="Distinct procedure codes observed in this source table; the same code can occur in several tables"))
    diagnosis_known = {diagnosis_code(code) for code in diagnosis_counts(root)}
    source_tables.append(dict(id="dnpr-t_diag", topic="conditions", label="t_diag", **coverage(diagnosis_known, condition_mapped),
        unit="codes", href="#conditions/unmapped",
        scope="Observed diagnosis codes; uses the same SKS-to-ICD notation conversion and reference coverage as the Conditions section"))

    titles = [("measurements", "Measurements", "#search", "NPU and DNK codes; related unit mappings are shown separately"),
              ("drugs", "Drugs & vaccines", "#drugs/products/review", "Products, ingredients, vaccine preparations and administration routes"),
              ("procedures", "Procedures", "#procedures/review", "Published mappings plus active SKS operations and observed procedure codes"),
              ("conditions", "Conditions", "#conditions/review", "Custom mappings and exact matches in the supplied standard reference"),
              ("caresites", "Care sites", "#caresites/sor/review", "SOR organisations and legacy departments; includes automated and unreviewed targets")]
    topics = [dict(id=key, label=label, href=href, note=note, **coverage(*primary_sets[key])) for key, label, href, note in titles]
    return dict(commit=labs["commit"], definition="Mapped means at least one positive OMOP target in the published snapshot. Unpublished proposals do not count as mapped. Conditions also include exact matches in the supplied standard reference. This measures mapping availability, not human approval or clinical validity.",
        countingNote="Multiple target rows count once per source identity. Coding systems and mapping types are counted separately. Vaccine preparations with different source identities are separate entries. Totals describe supplied inventories, not every code in Denmark.",
        topics=topics, tables=tables, sourceTables=source_tables)
