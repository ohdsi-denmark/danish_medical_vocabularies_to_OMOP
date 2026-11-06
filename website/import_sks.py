"""Generate the operation catalogue from SKScomplete and a versioned SKS code-list ZIP."""
import argparse
import hashlib
import json
import re
from datetime import date
from pathlib import Path
from zipfile import ZipFile


def import_operations(sks_path, lists_path, as_of):
    snapshot = as_of.strftime("%Y%m%d")
    sks = sks_path.read_bytes()
    lists = lists_path.read_bytes()
    with ZipFile(lists_path) as archive:
        members = [name for name in archive.namelist() if re.fullmatch(r"\d{8}_proc\.opr(?:_CHG)?\.txt", name)]
        if len(members) != 1:
            raise ValueError("Expected one versioned proc.opr list")
        member = members[0]
        release = date.fromisoformat(member[:8])
        reportable = set()
        for line in archive.read(member).decode("cp1252").splitlines():
            match = re.match(r"^\s+(K[A-Z0-9]*)\s+MEDLEM:\s+(\d{8})\s+(\d{8})\b", line)
            if match and match[2] <= snapshot <= match[3]:
                reportable.add(match[1])
        if not reportable:
            raise ValueError("No eligible K codes found in proc.opr")

    operations = {}
    for line in sks.decode("cp1252").splitlines():
        if not line.startswith("oprK"):
            continue
        code = line[3:23].strip()
        start = date.fromisoformat(line[23:31])
        end = date.fromisoformat(line[39:47])
        active = start <= as_of <= end
        # Prefer the active version, or the latest historical version for review context.
        rank = (active, start <= as_of, start)
        if code not in operations or rank > operations[code][0]:
            operations[code] = (rank, {
                "code": code, "name": line[47:167].strip(),
                "validFrom": start.isoformat(), "validUntil": end.isoformat(),
                "active": active, "reportable": active and code in reportable,
            })
    if not any(record["reportable"] for _, record in operations.values()):
        raise ValueError("SKScomplete and proc.opr have no active operation codes in common")
    return {
        "release": release.isoformat(), "asOf": as_of.isoformat(),
        "sksSha256": hashlib.sha256(sks).hexdigest(), "codeListsSha256": hashlib.sha256(lists).hexdigest(),
        "operations": [operations[code][1] for code in sorted(operations)],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skscomplete", type=Path)
    parser.add_argument("code_lists", type=Path)
    parser.add_argument("as_of", type=date.fromisoformat)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    catalogue = import_operations(args.skscomplete, args.code_lists, args.as_of)
    args.output.write_text(json.dumps(catalogue, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
