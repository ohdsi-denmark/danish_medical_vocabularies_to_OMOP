"""Publish only standard-reference rows for codes evidenced in Danish inputs."""
import argparse
import csv
from pathlib import Path

from conditions import danish_codes


def filter_reference(source, root):
    allowed = danish_codes(root)
    with (root / "Conditions/stcm_dacICD10.csv").open(encoding="utf-8-sig", newline="") as file:
        custom_targets = {row["target_concept_id"] for row in csv.DictReader(file)}
    labels = set()
    destination = root / "Conditions/reference_data/icd10_standard_for_danish_codes.csv"
    with source.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        rows = []
        for row in reader:
            if row["source_code"] in allowed:
                rows.append(row)
            if row["target_concept_id"] in custom_targets:
                labels.add((row["target_concept_id"], row["standard_concept_name"], row["vocabulary_id"]))
        fields = reader.fieldnames
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    with (destination.parent / "custom_target_labels.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(["target_concept_id", "target_name", "target_vocabulary_id"])
        writer.writerows(sorted(labels))
    print(f"Selected {len(rows)} rows for {len({row['source_code'] for row in rows})} Danish source codes.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    filter_reference(args.source, Path(__file__).resolve().parent.parent)
