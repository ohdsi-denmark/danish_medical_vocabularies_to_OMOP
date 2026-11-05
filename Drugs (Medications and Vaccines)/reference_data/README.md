# Drug and vaccine reference data

These working files support enrichment and review of the existing drug mappings. They were copied from the DNPR data catalogue on 5 November 2026. File contents and encodings are preserved byte for byte. The original folder names below are relative to the catalogue's mappings folder.

The date on the drug mapping details file comes from its original filename. Other file dates have not been inferred. Counts and mapping statuses describe the original working data and require reconciliation with the published mappings.

The website currently builds its Measurements pilot from explicit lab inputs. These reference files have not yet been integrated into its search index or download page.

| Local file | Original file | Contents | Encoding |
| --- | --- | --- | --- |
| [medications/dkma_drug_mapping_details_2021-01-04.csv](medications/dkma_drug_mapping_details_2021-01-04.csv) | dkma_provided/2021-01-04 01 DrugMapping.csv | Product and ingredient mapping details, including mapping status, ATC, formulation, strengths and targets. | Windows-1252 |
| [medications/dkma_dose_form_mappings.csv](medications/dkma_dose_form_mappings.csv) | dkma_provided/DoseForms.csv | Dose form mappings and counts. | Windows-1252 |
| [medications/dkma_unit_mappings.csv](medications/dkma_unit_mappings.csv) | dkma_provided/Units.csv | Source units, conversion factors and target units. | UTF-8 with BOM |
| [medications/dkma_ingredient_translations.csv](medications/dkma_ingredient_translations.csv) | dkma_provided/Ingredient Translations.csv | Ingredient translation working table. | Windows-1252 |
| [medications/dkma_ingredient_fallback_mappings.csv](medications/dkma_ingredient_fallback_mappings.csv) | dkma_provided/Ingredient Fallback.csv | Ingredient fallback mapping decisions. | UTF-8 with BOM |
| [medications/dkma_ingredient_override_mappings.csv](medications/dkma_ingredient_override_mappings.csv) | dkma_provided/Ingredient Overrule.csv | Ingredient override mapping decisions. | UTF-8 with BOM |
| [vaccines/ddv_vaccine_source_details.csv](vaccines/ddv_vaccine_source_details.csv) | vaccines/DDV_to_map_with_admin_vej_and_en.csv | Original Danish/English names, composite identifiers, preparation descriptions, links and frequencies. | Windows-1252 |
| [vaccines/ddv_additional_mapping_proposals.csv](vaccines/ddv_additional_mapping_proposals.csv) | vaccines/DDVALL_new_mappings.csv | Additional vaccine mappings for review before inclusion in the published mapping file. | UTF-8 with BOM |
