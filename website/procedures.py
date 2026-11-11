"""Build the SKS operation review catalogue from the published mapping and release."""
import csv
import hashlib
import json
import re
from collections import defaultdict
from datetime import date
from urllib.parse import quote

from drugs import positive_id, read_rows

TERMINOLOGY_FILES = ("SKScomplete.txt", "OPRklass_1995.txt", "SGDklass_ICD8.txt")
CLASSIFICATIONS = {"adm": "Administrative", "dia": "Diagnosis", "opr": "Operation", "pro": "Treatment / procedure",
                   "und": "Examination", "til": "Supplementary", "atc": "ATC", "uly": "Accident",
                   "res": "Result", "spc": "Specialty"}


def load_terminology(directory, as_of):
    """Read exact codes across classifications; never invent prefixes or strip leading zeroes."""
    records = defaultdict(list)
    hashes = {}
    for filename in TERMINOLOGY_FILES:
        content = (directory / filename).read_bytes()
        hashes[filename] = hashlib.sha256(content).hexdigest()
        for number, line in enumerate(content.decode("cp1252").splitlines(), 1):
            if len(line) != 214:
                raise ValueError(f"Unexpected SKS record width in {filename}:{number}")
            code = line[3:23].strip()
            start, changed, end = (date.fromisoformat(line[a:b]).isoformat()
                                   for a, b in ((23, 31), (31, 39), (39, 47)))
            records[code].append(dict(name=line[47:167].strip(), validFrom=start, validUntil=end,
                                      changed=changed, active=start <= as_of <= end,
                                      classification=CLASSIFICATIONS.get(line[:3], line[:3]),
                                      recordType=line[:3], file=filename))
    return records, hashes


def terminology_details(code, records, as_of):
    matches = records.get(code, [])
    # Prefer the full SKS catalogue. Bare historical codes can collide between classifications.
    current = [row for row in matches if row["file"] == "SKScomplete.txt"]
    candidates = current or matches
    active = [row for row in candidates if row["active"]]
    identities = {(row["file"], row["recordType"]) for row in active or candidates}
    if not candidates:
        return "", {"Terminology status": "No exact match in the supplied terminology files"}
    if len(identities) > 1:
        return "", {"Terminology status": "Ambiguous: exact code appears in multiple classifications",
                    "Terminology matches": " | ".join(sorted({f'{r["classification"]}: {r["name"]} ({r["file"]})' for r in candidates}))}
    previous_classifications = sorted({row["classification"] for row in candidates
                                       if (row["file"], row["recordType"]) not in identities})
    candidates = [row for row in candidates if (row["file"], row["recordType"]) in identities]
    chosen = max(candidates, key=lambda r: (r["active"], r["validFrom"] <= as_of, r["validFrom"], r["changed"]))
    others = sorted({r["name"] for r in candidates} - {chosen["name"]})
    details = {
        "Official terminology label": chosen["name"], "Classification": chosen["classification"],
        "Terminology status": "Active" if chosen["active"] else
            "Not yet valid on the catalogue date" if chosen["validFrom"] > as_of else "Historical / inactive",
        "Valid from": chosen["validFrom"], "Valid until": chosen["validUntil"],
        "Last changed": chosen["changed"], "Terminology file": chosen["file"],
    }
    if others:
        details["Other recorded labels"] = " | ".join(others)
    if previous_classifications:
        details["Previous classifications"] = " | ".join(previous_classifications)
    # Prefix parent is only inferred within the same file and classification.
    parent_day = min(as_of, chosen["validUntil"])
    for length in range(len(code) - 1, 0, -1):
        parent = [r for r in records.get(code[:length], [])
                  if (r["file"], r["recordType"]) == (chosen["file"], chosen["recordType"])
                  and r["validFrom"] <= parent_day <= r["validUntil"]]
        if parent:
            row = max(parent, key=lambda r: (r["active"], r["validFrom"] <= as_of, r["validFrom"]))
            details["Parent code (by prefix)"] = code[:length]
            details["Parent label"] = row["name"]
            break
    return chosen["name"], details


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
    terminology, terminology_hashes = load_terminology(directory, catalogue["asOf"])
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
        official_name, official_details = terminology_details(code, terminology, catalogue["asOf"])
        english = label.get("Name_en") or english_names.get(code, "")
        name = official_name or label.get("Name_da") or operation.get("name") or english or code
        status = "Outside the K operation catalogue"
        if operation:
            status = "Active" if operation["active"] else "Inactive on the catalogue date"
        details = {
            "Danish name": official_name or label.get("Name_da") or operation.get("name", ""),
            "English name": english,
            "Official SKS label": operation.get("name", ""),
            "Operation catalogue status": status,
            "Valid from": operation.get("validFrom", ""),
            "Valid until": operation.get("validUntil", ""),
            "Reportable in proc.opr": "Yes" if code in eligible else "No",
            **official_details,
            **{f"Source rows · {table}": value for table, value in sorted(by_table.get(code, {}).items())},
        }
        sources[code] = dict(id=code, code=code, name=name, category="procedures", details=[details],
                             occurrences=frequencies.get(code), currentOperation=code in eligible)

    unmapped = [dict(id=code, code=code, sourceKey=code, category="procedures", occurrences=frequencies.get(code))
                for code in sorted((eligible | frequencies.keys()) - mapped)]
    release = {key: catalogue[key] for key in ("release", "asOf", "sksSha256", "codeListsSha256")}
    release["terminologySha256"] = terminology_hashes
    download = f"https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP/raw/{commit}/{quote('Procedures/' + filename)}"
    return dict(commit=commit, release=release, categories={"procedures": "Procedure codes"}, sources=sources,
                mappings=mappings, targets=targets, unmapped=unmapped, downloads={"SKS procedure mappings": download})


def write_procedure_assets(data, out):
    """Keep the browsing index small; full details and export load on demand."""
    def write(path, value):
        content = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(content) > 25 * 1024 * 1024:
            raise ValueError(f"Procedure asset exceeds the hosting limit: {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    # Content-addressed paths prevent details from different deployments being mixed.
    digest = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:20]
    folder = f"procedure-details/{digest}"
    index = {key: value for key, value in data.items() if key != "sources"}
    index.update(sourceRows=[], detailRoot=folder, detailChunkSize=128, exportFile=f"{folder}/export.json")
    sources = list(data["sources"].items())
    for offset in range(0, len(sources), 128):
        chunk = dict(sources[offset:offset + 128])
        filename = f"{folder}/{offset // 128:03}.json"
        write(out / filename, dict(commit=data["commit"], sources=chunk))
        for code, source in chunk.items():
            # Search labels and classification without downloading table counts or provenance.
            details = source["details"][0]
            search = " ".join(str(details.get(key, "")) for key in
                ("English name", "Other recorded labels", "Classification", "Terminology matches")).strip()
            index["sourceRows"].append([code, source["name"], source["occurrences"], source["currentOperation"], search])
    write(out / index["exportFile"], data)
    write(out / "procedures.json", index)
