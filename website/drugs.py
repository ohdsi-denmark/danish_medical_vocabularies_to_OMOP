"""Prepare drug review records from the repository's mapping and reference files."""
import csv
import hashlib
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote


CATEGORIES = {
    "products": "Medication products",
    "ingredients": "Medication ingredients",
    "vaccines": "Vaccines",
    "routes": "Administration routes",
}


def read_rows(path, encoding="utf-8-sig"):
    with path.open(encoding=encoding, newline="") as file:
        for number, row in enumerate(csv.DictReader(file), 1):
            yield number, {key: (value or "").strip() for key, value in row.items() if key}


def positive_id(value):
    return value.isdigit() and int(value) > 0


def source_key(category, *values):
    digest = hashlib.sha256("\0".join(values).encode("utf-8")).hexdigest()[:24]
    return f"{category}-{digest}"


def build_drugs(root, commit):
    folder = root / "Drugs (Medications and Vaccines)"
    reference = folder / "reference_data"
    mappings = []
    sources = {}
    targets = {}
    downloads = {}
    base_url = "https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP"
    files = {
        "Medication mappings": "stcm_vnr.csv",
        "Vaccine mappings": "DDV_USAGI.csv",
        "Administration route mappings": "route_map.csv",
        "Additional vaccine proposals": "reference_data/vaccines/ddv_additional_mapping_proposals.csv",
    }
    for label, filename in files.items():
        path = quote(f"Drugs (Medications and Vaccines)/{filename}")
        downloads[label] = f"{base_url}/raw/{commit}/{path}"

    def add_source(category, code, name, identity=()):
        key = source_key(category, code, *identity)
        if key not in sources:
            sources[key] = dict(id=key, code=code, name=name, category=category, details=[])
        return sources[key]

    def add_mapping(record, source, file, number, status="Published"):
        record.update(
            id=f"{file.lower().replace(' ', '-')}-{number}", sourceKey=source["id"], category=source["category"],
            sourceFile=files[file], sourceRow=str(number), reviewState=status,
        )
        mappings.append(record)
        concept_id = record["conceptId"]
        if positive_id(concept_id):
            target = targets.setdefault(concept_id, dict(id=concept_id))
            for key, value in (("name", record.get("conceptName")), ("vocabulary", record.get("targetVocabulary")),
                               ("domain", record.get("domainId"))):
                if value:
                    target[key] = value

    for number, row in read_rows(folder / "stcm_vnr.csv"):
        code = row["source_code"]
        category = "ingredients" if code.startswith("Ingredient ") else "products"
        source = add_source(category, code, row["source_code_description"])
        add_mapping(dict(
            sourceCode=code, sourceName=row["source_code_description"], vocabulary=row["source_vocabulary_id"],
            conceptId=row["target_concept_id"], conceptName="", targetVocabulary=row["target_vocabulary_id"],
            domainId="Drug", mappingStatus="Recorded" if positive_id(row["target_concept_id"]) else "Unmapped",
            validStartDate=row["valid_start_date"], validEndDate=row["valid_end_date"], invalidReason=row["invalid_reason"],
        ), source, "Medication mappings", number)

    vaccine_sources = defaultdict(list)
    for file, state in (("Vaccine mappings", "Published"), ("Additional vaccine proposals", "Needs review")):
        for number, row in read_rows(folder / files[file]):
            preparation = row.get("ADD_INFO:full_add_eng", row.get("ADD_INFO:dosageoptionname", ""))
            source = add_source("vaccines", row["sourceCode"], row["sourceName"], (row["sourceName"], preparation))
            source["preparation"] = preparation
            # Frequencies help reconcile original preparation rows. They are not summed across targets.
            vaccine_sources[(row["sourceCode"], preparation, row["sourceFrequency"])].append(source)
            add_mapping({**row, "preparation": preparation}, source, file, number, state)

    for number, row in read_rows(folder / "route_map.csv"):
        source = add_source("routes", row["source_code"], row["source_code"])
        concept_id = row["standard_concept_id"]
        valid = positive_id(concept_id)
        add_mapping(dict(
            sourceCode=row["source_code"], sourceName=row["source_code"], vocabulary="Danish administration route",
            conceptId=concept_id if valid else "", conceptName=row["standard_concept_name"], domainId="Route",
            mappingStatus="Recorded" if valid else "Needs review", abbreviation=row["equivalent_acronym"],
            comment=row["notes"], recordedTarget=concept_id,
        ), source, "Administration route mappings", number)

    # Reconcile older product gaps with every positive target in the published file.
    published_mapped = {row["sourceKey"] for row in mappings
                        if row["reviewState"] == "Published" and positive_id(row["conceptId"])}
    product_details = defaultdict(list)
    ingredient_details = defaultdict(list)
    metadata = {}
    drug_file = reference / "medications/dkma_drug_mapping_details_2021-01-04.csv"
    labels = {
        "MappingStatus": "Historical mapping status", "SourceCode": "Original product identifier",
        "SourceName": "Product name", "SourceATCCode": "ATC code", "SourceFormulation": "Pharmaceutical form",
        "SourceCount": "Historical source count", "IngredientCode": "Ingredient identifier",
        "IngredientName": "Ingredient name", "IngredientNameEnglish": "English ingredient name",
        "CASNumber": "CAS number", "SourceIngredientAmount": "Ingredient amount",
        "SourceIngredentUnit": "Ingredient unit", "StrengthMarginPercentage": "Strength margin (%)",
        "MappingType": "Historical mapping type", "concept_id": "Historical target concept ID",
        "concept_name": "Historical target name", "vocabulary_id": "Historical target vocabulary",
        "concept_class_id": "Historical target class", "standard_concept": "Historical standard status",
        "concept_code": "Historical target vocabulary code", "valid_start_date": "Historical target valid from",
        "valid_end_date": "Historical target valid until",
    }
    for number, row in read_rows(drug_file, "cp1252"):
        product_code = f"Drug {row['SourceCode']}"
        key = source_key("products", product_code)
        if key not in sources and row["MappingStatus"] in ("Unmapped", "Incomplete"):
            source = add_source("products", product_code, row["SourceName"])
            source["backlogReason"] = "Gap in the historical DKMA working export; no positive target in the published medication mappings."
        detail = {label: row[field] for field, label in labels.items() if row.get(field) and row[field] != "*"}
        if detail.get("Historical source count") == "-1":
            detail["Historical source count"] = "Unavailable"
        detail["Source record"] = str(number)
        product_details[product_code].append(detail)
        for ingredient in {row["IngredientCode"].upper(), row["IngredientName"].upper()} - {"", "*"}:
            ingredient_details[ingredient].append(detail)
        if row["concept_id"] in targets:
            metadata[row["concept_id"]] = row

    for source in sources.values():
        if source["category"] == "products":
            source["details"] = product_details[source["code"]]
            source["referenceFile"] = str(drug_file.relative_to(folder)).replace("\\", "/")
        elif source["category"] == "ingredients":
            name = source["code"].removeprefix("Ingredient ").upper()
            source["details"] = ingredient_details[name]
            source["referenceFile"] = str(drug_file.relative_to(folder)).replace("\\", "/")
        # Avoid duplicate detail rows when several ingredients refer to the same product record.
        source["details"] = list({tuple(detail.items()): detail for detail in source["details"]}.values())

    for concept_id, row in metadata.items():
        targets[concept_id].update(
            name=row["concept_name"], vocabulary=row["vocabulary_id"], domain=row["domain_id"],
            conceptClass=row["concept_class_id"], code=row["concept_code"],
            metadataSource="Historical DKMA working export", validFrom=row["valid_start_date"],
            validUntil=row["valid_end_date"],
        )
    for mapping in mappings:
        if not mapping["conceptName"]:
            mapping["conceptName"] = targets.get(mapping["conceptId"], {}).get("name", "")

    vaccine_file = reference / "vaccines/ddv_vaccine_source_details.csv"
    vaccine_labels = {
        "vaccinename": "Danish vaccine name", "atccode": "ATC code", "drugid": "Original drug ID",
        "drugname": "Drug name", "full_name": "Danish full name", "full_name_en": "English full name",
        "dosageoptionname": "Dosage option", "freq": "Historical source frequency", "doage_form": "Pharmaceutical form",
        "Full_add": "Danish preparation details", "full_add_eng": "English preparation details", "link": "Reference URL",
    }
    for number, row in read_rows(vaccine_file, "cp1252"):
        candidates = vaccine_sources.get((row["full_code"], row["full_add_eng"], row["freq"]), [])
        if not candidates:
            candidates = [add_source("vaccines", row["full_code"], row["full_name_en"],
                                     (row["full_name_en"], row["full_add_eng"]))]
            candidates[0]["preparation"] = row["full_add_eng"]
            candidates[0]["backlogReason"] = "Preparation in the historical DDV input without a matching published code, preparation and frequency combination. Verify identity before proposing a target."
        for source in {item["id"]: item for item in candidates}.values():
            source["referenceFile"] = str(vaccine_file.relative_to(folder)).replace("\\", "/")
            source["details"].append({**{label: row[field] for field, label in vaccine_labels.items() if row.get(field)},
                                      "Source record": str(number)})

    # Attach supporting mapping decisions without importing an external vocabulary catalogue.
    support = [
        ("dkma_ingredient_translations.csv", "SourceId", "cp1252"),
        ("dkma_ingredient_fallback_mappings.csv", "SourceId", "utf-8-sig"),
        ("dkma_ingredient_override_mappings.csv", "SourceId", "utf-8-sig"),
    ]
    for filename, field, encoding in support:
        for number, row in read_rows(reference / "medications" / filename, encoding):
            key = source_key("ingredients", f"Ingredient {row[field]}")
            if key in sources:
                sources[key].setdefault("support", []).append(dict(file=filename, record=str(number), fields=row))

    for filename, field, source_field, encoding in (
        ("dkma_dose_form_mappings.csv", "DoseForm", "Pharmaceutical form", "cp1252"),
        ("dkma_unit_mappings.csv", "SourceUnit", "Ingredient unit", "utf-8-sig"),
    ):
        lookup = defaultdict(list)
        for number, row in read_rows(reference / "medications" / filename, encoding):
            lookup[row[field].upper()].append(dict(file=filename, record=str(number), fields=row))
        for source in sources.values():
            values = {detail.get(source_field, "").upper() for detail in source.get("details", [])} - {""}
            for value in sorted(values):
                source.setdefault("support", []).extend(lookup[value])

    unmapped = []
    proposed = {row["sourceKey"] for row in mappings if row["reviewState"] == "Needs review"}
    for key, source in sources.items():
        if key in published_mapped or key in proposed:
            continue
        source.setdefault("backlogReason", "No usable positive target recorded for this source in the published mapping file.")
        unmapped.append(dict(id=key, sourceKey=key, code=source["code"], category=source["category"]))

    reference_records = {}
    support_records = {}
    for source in sources.values():
        if source["category"] in ("products", "ingredients"):
            source["detailIds"] = [detail["Source record"] for detail in source["details"]]
            reference_records.update({detail["Source record"]: detail for detail in source.pop("details")})
        source["supportIds"] = []
        for record in source.pop("support", []):
            key = f"{record['file']}:{record['record']}"
            support_records[key] = record
            source["supportIds"].append(key)

    return dict(commit=commit, categories=CATEGORIES, mappings=mappings, sources=sources,
                referenceRecords=reference_records, supportRecords=support_records,
                targets=targets, unmapped=unmapped, downloads=downloads)
