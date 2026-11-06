"""Build the public lab snapshot from the checked-out mapping files."""
import csv
import json
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote
from drugs import build_drugs
from procedures import build_procedures

SITE = Path(__file__).resolve().parent
ROOT = SITE.parent
LABS = ROOT / "Measurements (Labs)"
DRUGS = ROOT / "Drugs (Medications and Vaccines)"
OUT = SITE / "dist"
REPO = "https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP"

class DefinitionText(HTMLParser):
    """Keep terminology text and notation without publishing source HTML."""

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ("sup", "sub"):
            self.parts.append("^(" if tag == "sup" else "_(")
        elif tag == "br":
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("sup", "sub"):
            self.parts.append(")")

    def handle_data(self, text):
        self.parts.append(text)


def terminology_rows(path, labels):
    # Positional labels preserve abbreviated and full columns with identical headers.
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.reader(file, delimiter=";")
        headers = next(reader)
        if len(headers) != len(labels):
            raise ValueError(f"Unexpected terminology columns in {path.name}")
        for values in reader:
            if len(values) != len(labels):
                raise ValueError(f"Unexpected terminology row in {path.name}")
            record = {}
            for label, value in zip(labels, values):
                if not value.strip():
                    continue
                parser = DefinitionText()
                parser.feed(value.strip())
                record[label] = "".join(parser.parts)
            record["Status"] = {"1": "Active", "0": "Inactive"}.get(record.pop("Active", ""), "Unknown")
            yield record


def rows(path, delimiter=","):
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file, delimiter=delimiter)
        reader.fieldnames = [name.strip().rstrip(";") for name in reader.fieldnames]
        for row in reader:
            yield {key: (value or "").strip() for key, value in row.items() if key}

def main():
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    input_paths = [f":(glob){folder.name}/**/*.{extension}"
                   for folder in (LABS, DRUGS) for extension in ("csv", "txt")]
    input_paths.append("Procedures/NCSP_SKS_mappings.csv")
    if subprocess.check_output(["git", "status", "--porcelain", "--", *input_paths], cwd=ROOT):
        raise SystemExit("Commit the mapping inputs before building a versioned snapshot.")
    files = {
        "NPU": "NPU_mapping_USAGI.csv",
        "DNK": "NPU_mapping_99_USAGI (DNK).csv",
        "Units": "Units for NPU and DNK codes.csv",
        "Unmapped NPU": "missing_NPU_code__w_frequency.txt",
        "National names (30 Oct 2026)": "NATIONAL__CSV_DK_BRUGSNAVN_2026-10-30.csv",
        "National concept definitions (30 Oct 2026)": "NATIONAL__CSV_DK_NPUBEGREB_2026-10-30.csv",
    }
    downloads = {
        label: f"{REPO}/raw/{commit}/{quote(f'Measurements (Labs)/{name}')}"
        for label, name in files.items()
    }
    mappings = []
    units = {}
    targets = {}
    for label in ("NPU", "DNK"):
        for number, row in enumerate(rows(LABS / files[label]), 1):
            if not row["sourceCode"]:
                continue
            row.update(id=f"{label}-{number}", vocabulary=label)
            mappings.append(row)
            if row["conceptId"].isdigit() and int(row["conceptId"]) > 0:
                targets[row["conceptId"]] = dict(id=row["conceptId"], name=row["conceptName"], domain=row["domainId"])
    for row in rows(LABS / files["Units"]):
        if row["npu"]:
            units.setdefault(row["npu"], []).append(row)
            if row["omop"].isdigit() and int(row["omop"]) > 0:
                targets[row["omop"]] = dict(id=row["omop"], name=row["omop label"], domain="Unit")
    mapped = {row["sourceCode"] for row in mappings if row["conceptId"].isdigit() and int(row["conceptId"]) > 0}
    unmapped = [
        dict(code=row["Code"], occurrences=row["Occurrences"])
        for row in rows(LABS / files["Unmapped NPU"], "\t")
        if row["Code"] and row["Code"] not in mapped
    ]
    codes = {row["sourceCode"] for row in mappings} | {row["code"] for row in unmapped}
    source_details = {code: {"concept": {}, "names": []} for code in codes}
    concept_labels = [
        "Created on", "Last changed on", "Version note", "Source code", "Short definition",
        "System (abbreviated)", "System specification (abbreviated)", "Component (abbreviated)",
        "Component specification (abbreviated)", "Property (abbreviated)",
        "Property specification (abbreviated)", "Unit (abbreviated)", "Full definition",
        "System", "System specification", "Component", "Component specification", "Property",
        "Property specification", "Unit", "Specialty code", "Context dependent", "Group header",
        "Scale type", "Replaces", "Replaced by", "Valid from", "Valid until", "Active", "Current instance",
    ]
    name_labels = [
        "Created on", "Last changed on", "Source code", "Short definition", "Full definition",
        "National short name", "Name type (source value)", "Approving organization",
        "Valid from", "Valid until", "Active", "Current instance",
    ]
    for record in terminology_rows(LABS / files["National concept definitions (30 Oct 2026)"], concept_labels):
        code = record["Source code"]
        if code in source_details:
            source_details[code]["concept"] = record
    for record in terminology_rows(LABS / files["National names (30 Oct 2026)"], name_labels):
        code = record.get("Source code")
        if code in source_details:
            source_details[code]["names"].append(record)
    OUT.mkdir(exist_ok=True)
    for path in (SITE / "public").iterdir():
        (OUT / path.name).write_bytes(path.read_bytes())
    data = dict(commit=commit, downloads=downloads, mappings=mappings, units=units,
                sourceDetails=source_details, terminologyDate="30 Oct 2026",
                unmapped=sorted(unmapped, key=lambda row: -int(row["occurrences"].lstrip("<"))),
                targets=targets)
    (OUT / "data.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    drug_data = build_drugs(ROOT, commit)
    (OUT / "drugs.json").write_text(json.dumps(drug_data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Submissions need identities and mapping records, not the larger reference details.
    proposal_data = {key: drug_data[key] for key in ("commit", "categories", "mappings", "targets", "unmapped")}
    proposal_data["sources"] = {
        key: {field: source[field] for field in ("id", "code", "name", "category", "preparation") if field in source}
        for key, source in drug_data["sources"].items()
    }
    (OUT / "drug-proposals.json").write_text(json.dumps(proposal_data, ensure_ascii=False,
                                                      separators=(",", ":")), encoding="utf-8")
    (OUT / "procedures.json").write_text(json.dumps(build_procedures(ROOT, commit), ensure_ascii=False,
                                                  separators=(",", ":")), encoding="utf-8")

if __name__ == "__main__":
    main()
