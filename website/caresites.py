"""Build compact care-site search indexes and on-demand, provenance-preserving records."""
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from urllib.parse import quote

from drugs import positive_id, read_rows

CATEGORIES = {"sor": "SOR organisations", "legacy": "Legacy departments", "visittypes": "Visit type crosswalk"}
METHODS = ["Manual", "Rule-based", "LLM", "Usagi (origin unspecified)", "Recorded crosswalk"]
FLAGS = ["No resolved target ID", "Prediction and recorded target disagree", "Conflicting labels in the visit crosswalk",
         "Multiple downstream visit types", "No downstream visit type recorded", "Unreviewed Usagi suggestion",
         "Predicted category not listed in the crosswalk", "Source code stored in scientific notation"]
FILES = ("SOR_to_OMOP_visit_mappings_complete.csv", "SOR_to_visit_concept.csv", "sor_to_nucc_USAGI.csv",
         "care_site_to_visit_type_map.csv", "shak_location_map.csv")
SHARDS = 1024


def care_bucket(key):
    value = 2166136261
    for byte in key.encode("utf-8"):
        value = ((value ^ byte) * 16777619) & 0xffffffff
    return value % SHARDS


def flag_bits(numbers):
    return sum(1 << number for number in set(numbers))


def location_rows(path):
    """Both specialty4 columns and unnamed columns are retained by their positions."""
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.reader(file)
        raw_headers = next(reader)
        counts = Counter(raw_headers)
        labels = {"afd": "Record type", "code": "Hospital code", "from": "Valid from", "updated": "Last updated",
                  "to": "Valid until", "location_id": "Location ID", "location_verification": "Location label", "name": "Hospital name",
                  "speciale1": "Specialty 1", "speciale2": "Specialty 2", "speciale4": "Specialty 4", "sks": "SKS marker", "valid": "Validity marker"}
        headers = [(labels.get(key, key) or "Unnamed field") + (f" (column {i + 1})" if counts[key] > 1 or not key else "")
                   for i, key in enumerate(raw_headers)]
        for number, values in enumerate(reader, 1):
            if len(values) != len(headers):
                raise ValueError("Unexpected SHAK location columns")
            yield dict(zip(headers, values), **{"Source file": path.name, "Source record": str(number)})


def build_caresites(root, commit, out):
    folder = root / "Caresites"
    hashes = {name: hashlib.sha256((folder / name).read_bytes()).hexdigest() for name in FILES}
    digest = hashlib.sha256((commit + json.dumps(hashes, sort_keys=True)).encode()).hexdigest()[:20]
    asset_root = f"care-site-data/{digest}"
    sources = {}
    mappings = defaultdict(list)
    indexes = {category: [] for category in CATEGORIES}
    crosswalk = defaultdict(list)
    category_ids = defaultdict(set)
    labels = defaultdict(set)
    usagi_labels = defaultdict(set)
    locations = defaultdict(list)
    for row in location_rows(folder / "shak_location_map.csv"):
        locations[row["Hospital code"]].append(row)
    with (folder / "care_site_to_visit_type_map.csv").open(encoding="utf-8-sig", newline="") as file:
        for number, row in enumerate(csv.DictReader(file, delimiter="\t"), 1):
            code, name, target = row["Classification Code"].strip(), row["Classification Name"].strip(), row["visit_concept_id"].strip()
            crosswalk[code].append(dict(name=name, conceptId=target, sourceRow=str(number)))
            labels[code].add(name)
            category_ids[name].add(code)
    legacy = list(read_rows(folder / "sor_to_nucc_USAGI.csv"))
    for _, row in legacy:
        if positive_id(row["conceptId"]):
            usagi_labels[row["conceptId"]].add(row["conceptName"])
    all_ids = set(labels) | set(usagi_labels)
    targets = {}
    for code in sorted(all_ids):
        names = sorted(usagi_labels.get(code) or labels[code])
        targets[code] = dict(id=code, name=names[0] if len(names) == 1 else "Multiple recorded labels — review needed",
                             domain="", recordedLabels=names)
    # These are the Visit concepts actually used in the supplied crosswalk, not an Athena extract.
    for rows in crosswalk.values():
        for row in rows:
            targets.setdefault(row["conceptId"], dict(id=row["conceptId"], name="Visit concept name not supplied", domain="Visit"))

    def target_name(code):
        return targets.get(code, {}).get("name", "Target name not supplied")

    def common_source(category, code, name, method, flags, **extra):
        key = f"{category}-{code}"
        source = dict(id=key, code=code, name=name or code, category=category, method=METHODS[method],
                      methodIndex=method, flags=flags, occurrences=None, details=[{}], **extra)
        sources[key] = source
        return source

    def mapping(source, number, target, filename, **extra):
        row = dict(id=f'{source["category"]}-row-{number}', sourceKey=source["id"], sourceCode=source["code"],
                   sourceName=source["name"], category=source["category"], conceptId=target, conceptName=target_name(target),
                   sourceFile=filename, sourceRow=str(number), reviewState="Published", domainId="",
                   mappingStatus="Human verified" if source["methodIndex"] == 0 else
                       "Review status not supplied" if source["methodIndex"] == 4 else "Not human verified",
                   mappingType="Maps to", method=source["method"])
        row.update(extra)
        mappings[source["id"]].append(row)
        return row

    resolved = {}
    for number, row in read_rows(folder / "SOR_to_visit_concept.csv"):
        if row["SorId"] in resolved:
            raise ValueError("Duplicate resolved SOR ID")
        resolved[row["SorId"]] = (number, row["code"])
    seen_sor = set()
    for number, row in read_rows(folder / "SOR_to_OMOP_visit_mappings_complete.csv"):
        code = row["SorId"]
        if code in seen_sor:
            raise ValueError("Duplicate SOR classification ID")
        seen_sor.add(code)
        method = {"Tomer": 0, "Keyword": 1, "": 2}.get(row["Verified_By"])
        if method is None:
            raise ValueError("Unknown SOR mapping origin; update the provenance rules")
        mapped_number, target = resolved.get(code, (None, ""))
        flags = []
        if not positive_id(target):
            flags.append(0)
        else:
            if row["Predicted_Category"] in category_ids and target not in category_ids[row["Predicted_Category"]]:
                flags.append(1)
            if len(labels.get(target, [])) > 1:
                flags.append(2)
            visits = {r["conceptId"] for r in crosswalk.get(target, []) if positive_id(r["conceptId"])}
            if len(visits) > 1:
                flags.append(3)
            if not visits:
                flags.append(4)
        if row["Predicted_Category"] not in category_ids:
            flags.append(6)
        source = common_source("sor", code, row["EntityName"], method, flag_bits(flags),
            predictedCategory=row["Predicted_Category"], justification=row["Justification"], verifiedBy=row["Verified_By"],
            classificationFile="SOR_to_OMOP_visit_mappings_complete.csv", classificationRow=str(number), error=row["error"])
        source["details"] = [{"SOR organisation ID": code, "Danish organisation name": row["EntityName"]}]
        if positive_id(target):
            mapping(source, mapped_number, target, "SOR_to_visit_concept.csv")
    if resolved.keys() - seen_sor:
        raise ValueError("Resolved SOR IDs lack classification records")

    for number, row in legacy:
        key = f'legacy-{row["sourceCode"]}'
        if key not in sources:
            code = row["sourceCode"]
            source = common_source("legacy", code, row.get("ADD_INFO:to_translate") or row["sourceName"], 3, 0)
            source["details"] = [{"Department code": code, "Danish department description": row.get("ADD_INFO:to_translate", ""),
                                   "English department description": row["sourceName"]}]
            parent = code if code in locations else code[:4] if re.fullmatch(r"[0-9A-Za-z]{7}", code) else ""
            source["locations"] = locations.get(parent, [])
            if source["locations"]:
                source["locationMatch"] = "Exact hospital code" if code == parent else f"Hospital prefix match ({parent}); not an exact department match"
        source = sources[key]
        approved = row["mappingStatus"] == "APPROVED" and bool(row["statusSetBy"])
        # Origin is only known for an explicitly human-approved row. <auto> is not evidence of LLM use.
        method = 0 if approved else 3
        if not approved:
            source["flags"] |= 1 << 5
        if re.search(r"[0-9][eE][+-][0-9]", row["sourceCode"]):
            source["flags"] |= 1 << 7
        if approved:
            source["methodIndex"] = 0
            source["method"] = METHODS[0]
            source["verifiedBy"] = row["statusSetBy"]
        mapping(source, number, row["conceptId"], "sor_to_nucc_USAGI.csv", method=METHODS[method],
                recordedSourceName=row["sourceName"], recordedDanishName=row.get("ADD_INFO:to_translate", ""),
                **{k: v for k, v in row.items() if k not in {"sourceCode", "sourceName", "conceptId", "conceptName"}})
        mappings[key][-1]["conceptName"] = row["conceptName"]

    for code, rows in crosswalk.items():
        flags = flag_bits(([2] if len(labels[code]) > 1 else []) + ([3] if len({r["conceptId"] for r in rows}) > 1 else []))
        source = common_source("visittypes", code, target_name(code), 4, flags)
        source["details"] = [{"Place-of-service concept ID": code, "Recorded classification labels": " | ".join(sorted(labels[code]))}]
        for row in rows:
            mapping(source, row["sourceRow"], row["conceptId"], "care_site_to_visit_type_map.csv", recordedClassification=row["name"])

    # An observed care-site target with no crosswalk is a supported source for a new Visit mapping.
    observed_targets = {}
    for records in list(mappings.values()):
        for row in records:
            if row["category"] in {"sor", "legacy"} and positive_id(row["conceptId"]):
                observed_targets.setdefault(row["conceptId"], row)
    for code, reference in observed_targets.items():
        if f"visittypes-{code}" in sources:
            continue
        source = common_source("visittypes", code, target_name(code), 4, flag_bits([0, 4]),
            referenceFile=reference["sourceFile"], referenceRow=reference["sourceRow"])
        source["details"] = [{"Observed care-site target concept ID": code,
            "Source reference file": reference["sourceFile"], "Source reference record": reference["sourceRow"],
            "Crosswalk coverage": "No downstream Visit mapping in the supplied crosswalk"}]

    # Sources remain separate even when the numeric code occurs in another coding system.
    for key, source in sorted(sources.items()):
        records = [row for row in mappings[key] if positive_id(row["conceptId"])]
        if not records:
            source["flags"] |= 1 << 0
        indexes[source["category"]].append([source["code"], source["name"], source["methodIndex"],
            [[row["sourceRow"], row["conceptId"], row["mappingStatus"], row["method"]] for row in records], source["flags"]])

    def write(path, value):
        content = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(content) > 25 * 1024 * 1024:
            raise ValueError(f"Care-site asset exceeds the hosting limit: {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    buckets = defaultdict(lambda: dict(commit=commit, sources={}, mappings=[]))
    for key, source in sources.items():
        bucket = buckets[care_bucket(key)]
        bucket["sources"][key] = source
        bucket["mappings"].extend(mappings[key])
    for bucket, data in buckets.items():
        write(out / f"{asset_root}/details/{bucket:03x}.json", data)
    for category, rows in indexes.items():
        write(out / f"{asset_root}/{category}.json", dict(commit=commit, rows=rows))
        validation = defaultdict(list)
        for row in rows:
            validation[care_bucket(f"{category}-{row[0]}") % 32].append(row)
        for bucket, selected in validation.items():
            write(out / f"{asset_root}/validation/{category}/{bucket:02x}.json", dict(commit=commit, rows=selected))
    stats = {category: dict(sources=len(rows), mapped=sum(bool(r[3]) for r in rows),
                           unresolved=sum(not r[3] for r in rows), methods=dict(Counter(METHODS[r[2]] for r in rows)))
             for category, rows in indexes.items()}
    base_url = f"https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP/raw/{commit}/"
    manifest = dict(commit=commit, dataset="caresites", categories=CATEGORIES, methods=METHODS, flags=FLAGS, stats=stats,
        hashes=hashes, assetRoot=asset_root, shardCount=SHARDS, validationShards=32, targets=targets, crosswalk=crosswalk,
        mappingFiles=dict(sor="SOR_to_visit_concept.csv", legacy="sor_to_nucc_USAGI.csv", visittypes="care_site_to_visit_type_map.csv"),
        indexes={category: f"{asset_root}/{category}.json" for category in CATEGORIES},
        release=dict(release="Supplied care-site files", asOf="Source snapshot date not provided"),
        downloads={name: base_url + quote("Caresites/" + name) for name in FILES},
        coverageNote="Recorded place-of-service targets and downstream Visit concepts are separate mappings. Conflicting recorded labels and visit types require review; automated classifications are not human approval.")
    export_sources = defaultdict(dict)
    export_items = defaultdict(list)
    for key, source in sources.items():
        if any(positive_id(row["conceptId"]) for row in mappings[key]):
            continue
        category = source["category"]
        export_sources[category][key] = {**source, "details": [{**source["details"][0],
            "Mapping method": source["method"], "Verified by": source.get("verifiedBy", ""),
            "Predicted category": source.get("predictedCategory", ""), "Classification justification": source.get("justification", ""),
            "Classification file": source.get("classificationFile", ""), "Classification record": source.get("classificationRow", ""),
            "Review flags": " | ".join(label for i, label in enumerate(FLAGS) if source["flags"] & (1 << i)),
        }]}
        export_items[category].append(dict(id=key, sourceKey=key, code=source["code"], category=category))
    manifest["unmappedFiles"] = {}
    for category in CATEGORIES:
        manifest["unmappedFiles"][category] = f"{asset_root}/unmapped-{category}.json"
        write(out / manifest["unmappedFiles"][category], dict(commit=commit, sources=export_sources[category], mappings=[], unmapped=export_items[category]))
    manifest["unmappedFile"] = manifest["unmappedFiles"]["sor"]
    write(out / "caresites.json", manifest)
    return manifest
