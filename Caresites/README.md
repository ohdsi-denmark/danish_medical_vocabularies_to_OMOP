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
