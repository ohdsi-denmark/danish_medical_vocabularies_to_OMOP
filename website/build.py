"""Build the public lab snapshot from the checked-out mapping files."""
import csv
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import quote

SITE = Path(__file__).resolve().parent
ROOT = SITE.parent
LABS = ROOT / "Measurements (Labs)"
OUT = SITE / "dist"
REPO = "https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP"

def rows(path, delimiter=","):
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file, delimiter=delimiter)
        reader.fieldnames = [name.strip().rstrip(";") for name in reader.fieldnames]
        for row in reader:
            yield {key: (value or "").strip() for key, value in row.items() if key}

def main():
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if subprocess.check_output(["git", "status", "--porcelain", "--", str(LABS)], cwd=ROOT):
        raise SystemExit("Commit the lab inputs before building a versioned snapshot.")
    files = {
        "NPU": "NPU_mapping_USAGI.csv",
        "DNK": "NPU_mapping_99_USAGI (DNK).csv",
        "Units": "Units for NPU and DNK codes.csv",
        "Unmapped NPU": "missing_NPU_code__w_frequency.txt",
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
    # Supply a CONCEPT export filtered to fields and vocabularies cleared for public display.
    concept_path = os.environ.get("PUBLIC_OMOP_CONCEPTS")
    if concept_path:
        for row in rows(Path(concept_path), "\t"):
            if row["standard_concept"] == "S" and not row["invalid_reason"]:
                targets[row["concept_id"]] = dict(
                    id=row["concept_id"], name=row["concept_name"], domain=row["domain_id"],
                    vocabulary=row["vocabulary_id"], code=row["concept_code"], standard=True,
                )
    OUT.mkdir(exist_ok=True)
    for path in (SITE / "public").iterdir():
        (OUT / path.name).write_bytes(path.read_bytes())
    data = dict(commit=commit, downloads=downloads, mappings=mappings, units=units,
                unmapped=sorted(unmapped, key=lambda row: -int(row["occurrences"].lstrip("<"))),
                targets=targets, omopRelease=os.environ.get("OMOP_RELEASE") if concept_path else None)
    if concept_path and not data["omopRelease"]:
        raise SystemExit("Set OMOP_RELEASE for the public concept export.")
    (OUT / "data.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

if __name__ == "__main__":
    main()
