#!/usr/bin/env bash
set -euo pipefail

# Usage: bash count_procedure_codes.sh SOURCE_DIR [OUTPUT_DIR] [--tables TABLE ...]
# Python's CSV reader handles quoted semicolons and CRLF in the ASC files.
exec "${OMOP_COUNT_PYTHON:-python3}" - "$@" <<'PYTHON'
import argparse
import csv
import sys
from collections import Counter
from pathlib import Path


TABLES = {
    "t_sksopr": ("C_OPR", "C_OPRART"),
    "t_sksube": ("C_OPR", "C_OPRART"),
    "t_psyk_sksopr": ("C_OPR", "C_OPRART"),
    "t_psyk_sksube": ("C_OPR", "C_OPRART"),
    "procedurer_kirurgi": ("procedurekode", "proceduretype"),
    "procedurer_andre": ("procedurekode", "proceduretype"),
    "t_diag": ("C_DIAG", None),
}

def count_table(path, table):
    code_column, type_column = TABLES[table]
    counts = Counter()
    skipped = Counter()
    with path.open(encoding="utf-8-sig", errors="surrogateescape", newline="") as file:
        reader = csv.reader(file, delimiter=";", strict=True)
        header = [name.strip().casefold() for name in next(reader, [])]
        indexes = []
        for name in (code_column, type_column):
            if name and header.count(name.casefold()) != 1:
                raise ValueError(f"{table}: expected one {name} column")
            indexes.append(header.index(name.casefold()) if name else None)
        code_index, type_index = indexes
        for row in reader:
            if not row:
                continue
            if len(row) != len(header):
                raise ValueError(f"{table}: inconsistent column count at line {reader.line_num}")
            if type_index is not None and row[type_index].strip() == "+":
                skipped["supplementary"] += 1
                continue
            code = row[code_index].strip()
            if not code or not code.isprintable():
                skipped["blank or unreadable code"] += 1
                continue
            counts[code] += 1
    details = ", ".join(f"{reason}: {count}" for reason, count in skipped.items())
    print(f"{table}: counted {sum(counts.values())} rows" + (f" ({details})" if details else ""), file=sys.stderr)
    return counts


def write_counts(path, header, rows):
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file, delimiter=";", lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description="Count DNPR procedure source codes from the NGC table directories.")
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_dir", nargs="?", type=Path, default=Path("procedure_counts"))
    parser.add_argument("--tables", nargs="+", choices=TABLES, help="Count only these tables. By default, count the supported tables present.")
    args = parser.parse_args()

    if not args.source_dir.is_dir():
        parser.error("SOURCE_DIR must be a directory")
    counts_by_table = {}
    missing = []
    try:
        for table in dict.fromkeys(args.tables or TABLES):
            path = args.source_dir / table / f"{table}_anonymized.asc"
            if not path.is_file():
                missing.append(table)
                continue
            counts_by_table[table] = count_table(path, table)
    except (ValueError, OSError, csv.Error) as error:
        # Encoding and CSV exceptions may contain raw source values.
        if isinstance(error, (UnicodeError, csv.Error)):
            parser.exit(1, f"Error: could not parse {table} as semicolon-delimited text.\n")
        parser.exit(1, f"Error: {error}\n")
    if missing and args.tables:
        parser.error("Missing requested table files: " + ", ".join(missing))
    if not counts_by_table:
        parser.error("No supported table files found under SOURCE_DIR")
    if missing:
        print("Tables absent from this extract: " + ", ".join(missing), file=sys.stderr)

    diagnoses = counts_by_table.pop("t_diag", Counter())
    combined = Counter()
    for counts in counts_by_table.values():
        combined.update(counts)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_counts(args.output_dir / "procedure_source_code_counts.csv", ["Code", "Frequency"],
                 sorted(combined.items(), key=lambda item: (-item[1], item[0])))
    write_counts(args.output_dir / "diagnosis_source_code_counts.csv", ["Code", "Frequency"],
                 sorted(diagnoses.items(), key=lambda item: (-item[1], item[0])))
    write_counts(args.output_dir / "procedure_counts_by_table.csv", ["Table", "Code", "Frequency"],
                 ((table, code, count) for table, counts in counts_by_table.items()
                  for code, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))))
    print(f"Wrote counts for {len(combined)} procedure codes and {len(diagnoses)} diagnosis codes to {args.output_dir}")


if __name__ == "__main__":
    main()
PYTHON
