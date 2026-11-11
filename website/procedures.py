"""Build the SKS operation review catalogue from the published mapping and release."""
import csv
import json
import re
from collections import defaultdict
from urllib.parse import quote

from drugs import positive_id, read_rows


def read_frequencies(path, by_table=False):
    """Keep disclosure-controlled values verbatim, including <5."""
    result = defaultdict(dict) if by_table else {}
    with path.open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file, delimiter=";"):
            code, frequency = row["Code"].strip(), row["Frequency"].strip()
            if not code or not re.fullmatch(r"(?:[0-9]+|<[1-9][0-9]*)", frequency):
                raise ValueError(f"Invalid source frequency in {path.name}")
            destination = result[code] if by_table else result
            key = row["Table"].strip() if by_table else code
            if key in destination:
                raise ValueError(f"Duplicate source frequency in {path.name}: {code}")
            destination[key] = frequency
    return result


def build_procedures(root, commit):
    directory = root / "Procedures"
    filename = "NCSP_SKS_mappings.csv"
    catalogue = json.loads((directory / "sks_operations.json").read_text(encoding="utf-8"))
    operations = {row["code"]: row for row in catalogue["operations"]}
    labels = {row["Code"]: row for _, row in read_rows(directory / "sks_source_labels.csv")}
    frequencies = read_frequencies(directory / "procedure_source_code_counts.csv")
    by_table = read_frequencies(directory / "procedure_counts_by_table.csv", by_table=True)
    if frequencies.keys() != by_table.keys():
        raise ValueError("Procedure totals and table counts contain different source codes")
    for code, frequency in frequencies.items():
        parts = by_table[code].values()
        if not frequency.startswith("<") and all(not value.startswith("<") for value in parts):
            if int(frequency) != sum(int(value) for value in parts):
                raise ValueError(f"Procedure totals and table counts disagree for {code}")
    mappings = []
    targets = {}
    mapped = set()
    codes = set()
    english_names = {}
    for record, row in read_rows(directory / filename):
        code = row["sourceCode"]
        if not code:
            continue
        codes.add(code)
        english_names.setdefault(code, row["sourceName"])
        row.update(id=f"sks-{record}", sourceKey=code, category="procedures", sourceFile=filename,
                   sourceRow=str(record), reviewState="Published")
        mappings.append(row)
        if positive_id(row["conceptId"]):
            mapped.add(code)
            targets[row["conceptId"]] = dict(id=row["conceptId"], name=row["conceptName"], domain=row["domainId"])

    eligible = {code for code, row in operations.items() if row["reportable"]}
    sources = {}
    for code in sorted(codes | eligible | frequencies.keys()):
        operation = operations.get(code, {})
        label = labels.get(code, {})
        english = label.get("Name_en") or english_names.get(code, "")
        name = label.get("Name_da") or operation.get("name") or english or code
        status = "Not in the SKS snapshot"
        if operation:
            status = "Active" if operation["active"] else "Inactive on the catalogue date"
        details = {
            "Danish name": label.get("Name_da") or operation.get("name", ""),
            "English name": english,
            "Official SKS label": operation.get("name", ""),
            "SKS status": status,
            "Valid from": operation.get("validFrom", ""),
            "Valid until": operation.get("validUntil", ""),
            "Reportable in proc.opr": "Yes" if code in eligible else "No",
            **{f"Source rows · {table}": value for table, value in sorted(by_table.get(code, {}).items())},
        }
        sources[code] = dict(id=code, code=code, name=name, category="procedures", details=[details],
                             occurrences=frequencies.get(code), currentOperation=code in eligible)

    unmapped = [dict(id=code, code=code, sourceKey=code, category="procedures", occurrences=frequencies.get(code))
                for code in sorted((eligible | frequencies.keys()) - mapped)]
    release = {key: catalogue[key] for key in ("release", "asOf", "sksSha256", "codeListsSha256")}
    download = f"https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP/raw/{commit}/{quote('Procedures/' + filename)}"
    return dict(commit=commit, release=release, categories={"procedures": "SKS operations"}, sources=sources,
                mappings=mappings, targets=targets, unmapped=unmapped, downloads={"SKS procedure mappings": download})
