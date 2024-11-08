# Danish Medical Vocabulary Mapping
This repository contains mappings between vocabularies used in Danish Medical systems and registries and OMOP standard vocabularies

# General
This repository is maintained by the Danish OHDSI Node. The mappings are contributed by the members of the node and have been created as a part of different local and EU projects. 
We invite the public to comment on our mappings via the issue system, and suggest corrections using the pull request system. 

## Acknowledgments
**add links**
* Danish Medicine Agency
* [INCEPT project](https://github.com/INCEPTdk)
* DARWIN EU project
* [https://www.darwin-eu.org](https://www.darwin-eu.org/)
* ARISTOTELES EU project
* [https://aristoteles-horizon.eu/the-project](https://aristoteles-horizon.eu/the-project/)

## How to contribute

### Suggesting a correction
**Insert tutorial here**

# Vocabularies
**Explanations and links**
In medical informatics, vocabularies refer to structured sets of terms and codes used to represent clinical data in a standardized way, ensuring consistency and interoperability across healthcare systems. Here are some prominent vocabularies often used in healthcare, including in OMOP and related databases:
1. LOINC (Logical Observation Identifiers Names and Codes): A vocabulary for laboratory and clinical observations. LOINC codes standardize terms for tests, measurements, and observations, allowing accurate data exchange between systems.
   https://loinc.org/
   
3. NPU (Nomenclature for Properties and Units): A vocabulary often used in laboratory sciences to define and standardize units and properties for measurements. NPU codes are commonly adopted in Europe for clinical laboratory reporting.
   https://npu-terminology.org/
   
5. UCUM (Unified Code for Units of Measure): This vocabulary provides standardized codes for units of measure. UCUM ensures that units (e.g., mg, mL, mmHg) are consistent and interpretable across systems, especially critical in international and multisite data sharing.
   https://ucum.org/
   
7. ATC (Anatomical Therapeutic Chemical Classification code): A unique code assigned to a medicine according to the organ or system it works on and how it works. The classification system is maintained by the World Health Organization (WHO).
   https://www.ema.europa.eu/en/glossary-terms/atc-code
   
9. SNOMED CT (Systematized Nomenclature of Medicine - Clinical Terms): A comprehensive clinical terminology that covers diseases, clinical findings, procedures, and other healthcare-related concepts. SNOMED CT enhances electronic health records by providing detailed clinical information.
    https://www.snomed.org/
   
11. ICD (International Classification of Diseases): A vocabulary for diagnosing and coding diseases, health conditions, and causes of death. ICD codes help track disease trends and health statistics globally.
    https://www.who.int/standards/classifications/classification-of-diseases
    
13. CPT (Current Procedural Terminology): A code set for medical, surgical, and diagnostic procedures. CPT codes are widely used in billing and electronic health records to document healthcare services.
    https://mmshub.cms.gov/measure-lifecycle/measure-specification/specify-code/CPT

## Medication - ATC + local codes
Anatomical Therapeutic Chemical (ATC)

https://www.who.int/tools/atc-ddd-toolkit/atc-classification

The Anatomical Therapeutic Chemical (ATC) classification system organizes active substances into groups based on the organ or system they target, as well as their therapeutic, pharmacological, and chemical characteristics.

Drugs are classified in groups at five different levels:
1. ATC 1st level
   The system has fourteen main anatomical or pharmacological groups.
   
3. ATC 2nd level
   Pharmacological or Therapeutic subgroup.
   
5. ATC 3rd& 4th levels
   Chemical, Pharmacological or Therapeutic subgroup

4. ATC 5th level
   Chemical substance
   
## Lab Tests - NPU
https://sundhedsdatastyrelsen.dk/da/rammer-og-retningslinjer/om-terminologi/npu/sogevejledning-labterm-npu

**Description of NPU, LOINC and UCUM and of the mapping principles from our paper**

The Nomenclature, Properties, and Units (NPU) terminology is used in Danish healthcare for coding lab tests and results.The full NPU terminology contains 9035 codes as of August 2024. This offers a structured approach to standardizing laboratory data, ensuring that properties and units are consistently represented across the registry. Mapping the entire codes set to an OMOP standard vocabulary is a daunting task, we therefore chose to map the top 528 codes by usage frequency, representing 99% of Danish lab orders, which were mapped to LOINC (Logical Observation Identifiers Names and Codes), an international standard for laboratory and clinical observations. The mapping was performed by us and reviewed by a clinical biochemist. We identified a direct equivalent in the LOINC vocabulary for X codes, for Y codes, we found a broader concept in LOINC vocabulary, and for Z codes we found a narrower one. However, no equivalent LOINC code was available for the remaining Z codes.
The NPU codes often specify exact measurement units, (e.g., millimoles per gram), while LOINC codes often only specify the type of measurements (e.g. moles/volume)., requiring additional mappings to Unified Code for Units of Measure (UCUM). UCUM is the standard used by OMOP for representing units in a consistent way, ensuring precise interpretations across different datasets.

The mapping principles:
1.	Direct Matches: Some NPU codes had direct equivalents in LOINC and were mapped accordingly.
2.	Presence Tests: For tests where results are 0/1, positive/negative or any other boolean form, the mapping incorporated standardized LOINC codes, is recorded in OMOP as a value_as_concept_id.
3.	Categorical Data: In Z cases the procedure contains a table or other description mapping arbitrary numbers into result categories. The median is given for categories where a range is defined, the next integer under the reference value for open ended lower range and the next integer above the reference value for open-ended upper ranges.
4.	Undocumented or Obsolete Codes: For some retired or undocumented NPU codes, mapping was challenging due to limited information, and these codes were flagged accordingly.

## Vaccines - ATC
https://atcddd.fhi.no/atc_ddd_index/?showdescription=yes&code=J07

In the ATC (Anatomical Therapeutic Chemical) classification system, vaccines fall under the code "J07." This group is divided into bacterial vaccines (J07A), viral vaccines (J07B), combined bacterial and viral vaccines (J07C), and other vaccines (J07X). These classifications allow vaccines to be grouped by the type of pathogen they target, with further divisions by indication at the fourth level.

## Procedures - SKS
https://sundhedsdatastyrelsen.dk/da/rammer-og-retningslinjer/om-klassifikationer/sks-klassifikationer/klassifikation-operationer

The SKS (Sundheds Klassifikations System) is the Danish health classification system used for coding various medical and administrative aspects within healthcare, helping in organization, documentation, and statistical reporting.
