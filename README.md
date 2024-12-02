# Danish Medical Vocabulary Mapping
This repository contains mappings between vocabularies used in Danish Medical systems and registries and OMOP standard vocabularies

# General
This repository is maintained by the Danish OHDSI Node. The mappings are contributed by the members of the node and have been created as a part of different local and EU projects. 
We invite the public to comment on our mappings via the issue system, and suggest corrections using the pull request system. 

## Acknowledgments
We thank the following projects  that have provided substantial parts of the mappings in this repository or other material assistance to this work. 

* [Danish Medicine Agency](https://laegemiddelstyrelsen.dk/)
* [INCEPT project](https://github.com/INCEPTdk)
* [DARWIN EU project](https://www.darwin-eu.org)
* [ARISTOTELES EU project](https://aristoteles-horizon.eu/the-project/)

## How to contribute

### Suggesting a correction
 
* If you have a general comment about the mappings you are welcome to open an issue in the [issue system](https://github.com/ohdsi-denmark/danish_medical_vocabularies_to_OMOP/issues). 
* If you want to change a specific code mapping you can edit the relevant table and submit a pull request. For example, here I suggest a change to the DNK code unit mapping:
![image](https://github.com/user-attachments/assets/a6b2d39b-9e1e-4f5e-9494-515ddda1d162)
1. Press edit (the small pencil on the right).
2. Make the change you want to make.
3. Press commit changes (green button on the top right)
4. In the window that opens write a justification for your changes and then choose the bottom option (Create a new branch)
![image](https://github.com/user-attachments/assets/52aa8f06-f7f2-4a07-b8fe-8416436623c1)
5. press "Propose change" (green bottom at the bottom).
6. In the window that opens press "Create pull request" (green button in the middle)
![image](https://github.com/user-attachments/assets/f48bd26c-af33-4167-9af0-82ef574fdf5c)

### Adding mappings
Some of the vocabularies have been mapped to the extent that covers 99% of the lines in the Danish Repositories. However, there is a long tail of codes that have not been mapped.
We invite contributors to map these and add them to the existing mapping files. For example, in the Measurements folder one can find a report listing unmapped codes in descending order of the number of rows using this code in the lab_dm_forsker repository.  

## Source Vocabularies
The Danish National Repository system uses the following vocabularies for coding medical concepts:

### Medication - ATC + local codes

Anatomical Therapeutic Chemical (ATC)
   
[ATC]( https://www.ema.europa.eu/en/glossary-terms/atc-code) (Anatomical Therapeutic Chemical Classification code): A unique code assigned to a medicine according to the organ or system it works on and how it works. The classification system is maintained by the World Health Organization (WHO).

     
### Lab Tests - NPU

[NPU](https://npu-terminology.org/) (Nomenclature for Properties and Units): A vocabulary often used in laboratory sciences to define and standardize units and properties for measurements. NPU codes are commonly adopted in Europe for clinical laboratory reporting.
Here, we provide a mapping of the top 528 NPU codes to LOINC and UCUM vocabularies: [LOINC]( https://loinc.org/) (Logical Observation Identifiers Names and Codes): A vocabulary for laboratory and clinical observations. [UCUM](https://ucum.org/) (Unified Code for Units of Measure): This vocabulary provides standardized codes for units of measure. UCUM ensures that units (e.g., mg, mL, mmHg) are consistent and interpretable across systems, especially critical in international and multisite data sharing.

The NPU terminology is used in [Danish](https://sundhedsdatastyrelsen.dk/da/rammer-og-retningslinjer/om-terminologi/npu/sogevejledning-labterm-npu) healthcare for coding lab tests and results. Mapping the entire codes set to an OMOP standard vocabulary is a daunting task, we therefore chose to map the top 528 codes by usage frequency, representing 99% of Danish lab orders, which were mapped to LOINC. The mapping was performed by us and reviewed by a clinical biochemist. We identified a direct equivalent in the LOINC vocabulary for 25% of the codes, for 63% of the codes, we found a broader concept in LOINC vocabulary, and for 10% of the codes we found a narrower one. However, no equivalent LOINC code was available for the remaining 2% codes.
The NPU codes often specify exact measurement units, (e.g., millimoles per gram), while LOINC codes often only specify the type of measurements (e.g. moles/volume)., requiring additional mappings to Unified Code for Units of Measure (UCUM). UCUM is the standard used by OMOP for representing units in a consistent way, ensuring precise interpretations across different datasets.

The mapping principles:
1.	Direct Matches: Some NPU codes had direct equivalents in LOINC and were mapped accordingly.
2.	Presence Tests: For tests where results are 0/1, positive/negative or any other boolean form, the mapping incorporated standardized LOINC codes, is recorded in OMOP as a value_as_concept_id.
3.	Categorical Data: In Z cases the procedure contains a table or other description mapping arbitrary numbers into result categories. The median is given for categories where a range is defined, the next integer under the reference value for open ended lower range and the next integer above the reference value for open-ended upper ranges.
4.	Undocumented or Obsolete Codes: For some retired or undocumented NPU codes, mapping was challenging due to limited information, and these codes were flagged accordingly.

### Vaccines - ATC

The [ATC classification system](https://www.who.int/tools/atc-ddd-toolkit/atc-classification) organizes active substances into groups based on the organ or system they target, as well as their therapeutic, pharmacological, and chemical characteristics.

Drugs are classified in groups at five different levels:
1. ATC 1st level
   The system has fourteen main anatomical or pharmacological groups.
   
3. ATC 2nd level
   Pharmacological or Therapeutic subgroup.
   
5. ATC 3rd& 4th levels
   Chemical, Pharmacological or Therapeutic subgroup

4. ATC 5th level
  
In the ATC classification system, [vaccines](https://atcddd.fhi.no/atc_ddd_index/?showdescription=yes&code=J07#:~:text=The%20vaccines%20are%20divided%20in,included%20in%20the%20level%20names.) are divided in bacterial, viral and combinations of bacterial and viral at separate ATC 3rd levels. This group is codede as "J07." and subdevided into bacterial vaccines (J07A), viral vaccines (J07B), combined bacterial and viral vaccines (J07C), and other vaccines (J07X). These classifications allow vaccines to be grouped by the type of pathogen they target, with further divisions by indication at the fourth level.

### Procedures - SKS

The [SKS](https://sundhedsdatastyrelsen.dk/da/rammer-og-retningslinjer/om-klassifikationer/sks-klassifikationer/klassifikation-operationer) (Sundheds Klassifikations System) is the Danish health classification system used for coding various medical and administrative aspects within healthcare, helping in organization, documentation, and statistical reporting.

[ICD](https://www.who.int/standards/classifications/classification-of-diseases) (International Classification of Diseases): A vocabulary for diagnosing and coding diseases, health conditions, and causes of death. ICD codes help track disease trends and health statistics globally.
   
    
[CPT](https://mmshub.cms.gov/measure-lifecycle/measure-specification/specify-code/CPT) (Current Procedural Terminology): A code set for medical, surgical, and diagnostic procedures. CPT codes are widely used in billing and electronic health records to document healthcare services.
   
