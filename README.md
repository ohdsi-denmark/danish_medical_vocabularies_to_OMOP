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
* ARISTOTELES EU project

## How to contribute

### Suggesting a correction
**Insert tutorial here**

# Vocabularies
**add explanations and links**
## Medication - ATC + local codes

## Lab Tests - NPU
**Description of NPU, LOINC and UCUM and of the mapping principles from our paper**

The Nomenclature, Properties, and Units (NPU) terminology is used in Danish healthcare for coding lab tests and results.The full NPU terminology contains 9035 codes as of August 2024. This offers a structured approach to standardizing laboratory data, ensuring that properties and units are consistently represented across the registry. Mapping the entire codes set to an OMOP standard vocabulary is a daunting task, we therefore chose to map the top 528 codes by usage frequency, representing 99% of Danish lab orders, which were mapped to LOINC (Logical Observation Identifiers Names and Codes), an international standard for laboratory and clinical observations. The mapping was performed by us and reviewed by a clinical biochemist. We identified a direct equivalent in the LOINC vocabulary for X codes, for Y codes, we found a broader concept in LOINC vocabulary, and for Z codes we found a narrower one. However, no equivalent LOINC code was available for the remaining Z codes.
The NPU codes often specify exact measurement units, (e.g., millimoles per gram), while LOINC codes often only specify the type of measurements (e.g. moles/volume)., requiring additional mappings to Unified Code for Units of Measure (UCUM). UCUM is the standard used by OMOP for representing units in a consistent way, ensuring precise interpretations across different datasets.

The mapping principles:
1.	Direct Matches: Some NPU codes had direct equivalents in LOINC and were mapped accordingly.
2.	Presence Tests: For tests where results are 0/1, positive/negative or any other boolean form, the mapping incorporated standardized LOINC codes, is recorded in OMOP as a value_as_concept_id.
3.	Categorical Data: In Z cases the procedure contains a table or other description mapping arbitrary numbers into result categories. The median is given for categories where a range is defined, the next integer under the reference value for open ended lower range and the next integer above the reference value for open-ended upper ranges.
4.	Undocumented or Obsolete Codes: For some retired or undocumented NPU codes, mapping was challenging due to limited information, and these codes were flagged accordingly.

## Vaccines - ATC

## Procedures - SKS
