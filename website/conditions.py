"""Build Danish ICD-10 custom mapping review and observed coverage candidates."""
import json
import hashlib
import csv
import re
from collections import defaultdict
from urllib.parse import quote

from drugs import positive_id, read_rows
from procedures import load_terminology, terminology_details


def diagnosis_code(code):
    """SKS D prefix and ICD decimal notation; retain other observed spellings exactly."""
    if re.fullmatch(r"D[A-Z][0-9]{2}[A-Z0-9]*", code):
        value = code[1:]
        return value[:3] + ("." + value[3:] if len(value) > 3 else "")
    return code


def danish_codes(root):
    codes = {row["source_code"] for _, row in read_rows(root / "Conditions/stcm_dacICD10.csv")}
    codes.update(diagnosis_code(code) for code in diagnosis_counts(root)
                 if re.fullmatch(r"D[A-Z][0-9]{2}[A-Z0-9]*", code))
    return codes


def diagnosis_counts(root):
    counts = defaultdict(list)
    with (root / "Procedures/diagnosis_source_code_counts.csv").open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file, delimiter=";"):
            code, value = row["Code"].strip(), row["Frequency"].strip()
            if not code or not re.fullmatch(r"(?:[0-9]+|<[1-9][0-9]*)", value):
                raise ValueError("Invalid diagnosis frequency")
            counts[code].append(value)
    return counts


def build_conditions(root, commit):
    folder = root / "Conditions"
    filename = "stcm_dacICD10.csv"
    release = json.loads((root / "Procedures/sks_operations.json").read_text(encoding="utf-8"))
    terms, hashes = load_terminology(root / "Procedures", release["asOf"])
    diagnosis_terms = {code: [row for row in rows if row["recordType"] == "dia"] for code, rows in terms.items()}
    counts = diagnosis_counts(root)
    observed = defaultdict(dict)
    for raw, count in counts.items():
        observed[diagnosis_code(raw)][raw] = count
    mappings = []
    reference_file = "reference_data/icd10_standard_for_danish_codes.csv"
    references = defaultdict(list)
    target_names = defaultdict(set)
    allowed = danish_codes(root)
    for number, row in read_rows(folder / reference_file):
        if row["source_code"] not in allowed:
            raise ValueError("Standard condition reference includes a code outside the Danish inputs")
        if positive_id(row["target_concept_id"]):
            references[row["source_code"]].append(dict(row, sourceRow=str(number), sourceFile=reference_file))
            target_names[row["target_concept_id"]].add(row["standard_concept_name"])
    descriptions = {}
    mapped = set()
    label_file = folder / "reference_data/custom_target_labels.csv"
    custom_rows = list(read_rows(folder / filename))
    allowed_targets = {row["target_concept_id"] for _, row in custom_rows}
    for _, row in read_rows(label_file):
        if row["target_concept_id"] not in allowed_targets:
            raise ValueError("Custom target labels include a concept outside the Danish custom mappings")
        target_names[row["target_concept_id"]].add(row["target_name"])
    for number, row in custom_rows:
        code = row["source_code"]
        if descriptions.get(code, "NA") == "NA":
            descriptions[code] = row["source_code_description"]
        valid = not row["invalid_reason"] and row["valid_start_date"] <= release["asOf"] <= row["valid_end_date"]
        mappings.append(dict(row, id=f"condition-{number}", sourceKey=code, sourceCode=code,
            sourceName="" if row["source_code_description"] == "NA" else row["source_code_description"],
            conceptId=row["target_concept_id"], conceptName=" | ".join(sorted(target_names.get(row["target_concept_id"], []))) or "Target name unavailable in supplied files",
            vocabularyId=row["target_vocabulary_id"], domainId="Unavailable", category="conditions",
            sourceFile=filename, sourceRow=str(number), reviewState="Published",
            mappingStatus="Published" if valid else "Inactive mapping", mappingType="Maps to",
            comment="No review status or target metadata supplied in this source-to-concept mapping file."))
        if valid and positive_id(row["target_concept_id"]):
            mapped.add(code)
    sources = {}
    for code in sorted(set(observed) | set(descriptions)):
        # The dotted custom mapping file omits the SKS diagnosis prefix.
        sks = "D" + code.replace(".", "") if re.fullmatch(r"[A-Z][0-9]{2}(?:\.[A-Z0-9]+)?", code) else code
        # Restrict standard SKS lookups to diagnosis records; other source values remain visible.
        name, details = terminology_details(sks, diagnosis_terms, release["asOf"])
        description = descriptions.get(code, "")
        if description == "NA":
            description = ""
        name = name or description or code
        raw_counts = observed.get(code, {})
        values = [value for rows in raw_counts.values() for value in rows]
        # Never infer an exact total from a disclosure-controlled component.
        frequency = values[0] if len(values) == 1 else (
            str(sum(map(int, values))) if values and all(not v.startswith("<") for v in values) else None)
        details = {"ICD-10-DK code": code, "SKS lookup code": sks,
            "Published source description": description, **details,
            "Custom mapping coverage": "Published custom mapping" if code in mapped else "No active custom mapping",
            "Standard mapping coverage": "Present in supplied reference" if code in references else "No exact match in supplied reference",
            "Standard reference target IDs": " | ".join(sorted({r["target_concept_id"] for r in references.get(code, [])})),
            "Standard reference target names": " | ".join(sorted({r["standard_concept_name"] for r in references.get(code, [])})),
            "Standard reference vocabulary": " | ".join(sorted({r["vocabulary_id"] for r in references.get(code, [])})),
            "Observed source codes": " | ".join(raw_counts),
            "Observed source code counts": " | ".join(f"{raw}: {', '.join(count)}" for raw, count in raw_counts.items())}
        sources[code] = dict(id=code, code=code, name=name, category="conditions", details=[details],
            occurrences=frequency, currentOperation=False, references=references.get(code, []))
    candidates = [dict(id=code, sourceKey=code, code=code, category="conditions", occurrences=sources[code]["occurrences"])
                  for code in sorted(set(observed) - mapped)]
    url = f"https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP/raw/{commit}/{quote('Conditions/' + filename)}"
    uncovered = [item["code"] for item in candidates if item["code"] not in references]
    return dict(commit=commit, release=dict(release=release["release"], asOf=release["asOf"], terminologySha256=hashes,
            standardReferenceSha256=hashlib.sha256((folder / reference_file).read_bytes()).hexdigest(),
            customTargetLabelsSha256=hashlib.sha256(label_file.read_bytes()).hexdigest()),
        categories={"conditions": "Condition codes"}, sources=sources, mappings=mappings,
        targets={key: dict(id=key, name=" | ".join(sorted(names)), domain="Unavailable") for key, names in target_names.items()},
        referenceTargets={code: sorted({(row["target_concept_id"], row["standard_concept_name"], row["vocabulary_id"]) for row in rows}) for code, rows in references.items()},
        unmapped=candidates,
        uncovered=uncovered, referenceCodes=sorted(references),
        coverageNote="Coverage is based on the supplied standard mapping reference and Danish custom file. The reference has no source-vocabulary or release metadata; matches do not establish current ICD10-only coverage.",
        downloads={"Danish ICD-10 custom mappings": url,
            "Standard reference for Danish codes": f"https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP/raw/{commit}/{quote('Conditions/' + reference_file)}"})
