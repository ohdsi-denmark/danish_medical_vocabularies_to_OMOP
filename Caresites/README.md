# Care sites

| File | Content |
|---|---|
| `SOR_to_visit_concept.csv` | 158,587 SOR organisations (`SorId`) mapped to an OMOP place-of-service concept (`code`). |
| `SOR_to_OMOP_visit_mappings_complete.csv` | The classification behind it: 159,613 SOR organisations with name, predicted place-of-service category, justification and how it was set (`Verified_By`). |
| `care_site_to_visit_type_map.csv` | Place-of-service concept to OMOP visit concept (tab-separated). |
| `sor_to_nucc_USAGI.csv` | Usagi mapping of SHAK/SOR department names to OMOP concepts (LPR1/LPR2 care sites). |
| `shak_location_map.csv` | SHAK code to region/location. |

SOR is the Danish Healthcare Organisation Register. Care sites were
classified with keyword rules and LLM-assisted classification, as
described in the ARISTOTELES DNHR-to-OMOP paper.

## Website review

The website separates three coding contexts: **SOR organisations**, **Legacy
departments**, and the **Visit type crosswalk**. Each has review, new-mapping
and bulk-proposal screens. SOR and department IDs stay as strings; they are
never converted to numbers or expanded from scientific notation.

SOR origin follows `Verified_By`: `Tomer` means manual (81 organisations),
`Keyword` means rule-based (37,028), and a blank field means LLM (122,504).
This interpretation is confirmed by the ETL classification and result-joining
scripts: human/rule rows were excluded from LLM classification and added back
afterward. A populated target does not mean human review. The specific keyword
rule is not recorded, so the website does not guess it from the name.

Resolved targets come from `SOR_to_visit_concept.csv`, joined by exact SOR ID.
The 1,026 organisations without a positive resolved ID populate the suggestion
list, regardless of whether they have a predicted category. LLM explanations,
manual verification, source files and original record numbers are retained.

The legacy Usagi file remains useful to the ETL for older department codes.
It has 3 explicitly approved rows and 4,188 unchecked rows. Unchecked origin
is labelled unspecified, rather than being assumed to be LLM or manual.
All 4,191 rows are preserved across 4,092 department codes. SHAK location history
is supporting context; a hospital-prefix match is labelled as such. Both
`speciale4` columns and the unnamed column are retained by position.

Place-of-service classifications and downstream OMOP Visit concepts are
different mapping layers. The crosswalk's 160 original rows, including
conflicting labels and targets, remain individually reviewable across 101
source concepts. Its labels are recorded labels, not verified canonical
vocabulary metadata. Proposals identify the exact source file and row and
never silently choose among conflicting crosswalk rows.

An additional 118 concepts are used as targets by the supplied SOR or legacy
department mappings but have no row in this crosswalk. They are shown on its
suggestion screen with a reference to the original care-site mapping. This
does not establish that the original classification is correct. Their CSV
template is separate from the 1,026 unresolved SOR organisations.

Search loads a compact index for the selected coding context. Full records
load on demand; the large classification CSV is not served as a website asset.
New-mapping CSVs contain only unresolved source codes for the selected context,
including available origin, justification or reference metadata, followed by
an empty `OMOP_concept_id` column.
Individual and bulk proposals use the same GitHub Issue workflow as the other
sections. Submission validation reads trusted snapshot groups and preserves
origin and review status in the issue or attachment.
