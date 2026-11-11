# Conditions: ICD-10-DK to SNOMED

`stcm_dacICD10.csv` contains 525 mappings for 454 Danish-specific
ICD-10 codes (ICD10-DK, e.g. `C20.9M`) used in the Danish National
Patient Registry. Some codes map to more than one target concept.

The file follows the OMOP `source_to_concept_map` layout. ICD-10 codes
not listed here are mapped with the standard OHDSI ICD10 vocabulary
("Maps to" relationships).

The mappings were created in the ARISTOTELES project.

The website groups these rows for review and supports proposed custom mapping
changes. Original rows, duplicate pairs and non-SNOMED targets remain intact.

`reference_data/icd10_standard_for_danish_codes.csv` is a restricted subset of
the ETL standard mapping reference: only codes evidenced by the Danish diagnosis
counts or this custom file are included. `reference_data/custom_target_labels.csv`
contains labels only for targets used in the custom file. The full ETL export
is kept under the Git-ignored `private_reference/` directory and is not deployed.
The standard reference does not identify its source vocabulary or release, so
absence from these files is presented as a coverage gap requiring review rather
than proof that the current OHDSI vocabulary has no mapping.
