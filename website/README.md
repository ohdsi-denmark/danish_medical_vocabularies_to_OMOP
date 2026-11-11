# Danish OMOP Mapping Explorer

The explorer uses the lab, medication, vaccine, administration route, procedure and condition mapping files in this repository. It builds versioned search snapshots and links to the corresponding original GitHub downloads. Public submissions open issues in the same repository.

The national BRUGSNAVN and NPUBEGREB exports dated 30 October 2026 enrich mapped and backlog codes by exact DNK/NPU code. The importer preserves every national name, both abbreviated and full concept properties, inactive status, and replacement references. Danish names and definitions are searchable. The existing frequency report determines the backlog membership. Missing terminology entries remain visible with an explicit fallback. Source definition markup is converted to plain text, with superscripts represented as `^(...)` and subscripts as `_(...)`. National terminology dates retain the source's date and time without assuming a time zone.

## Preview locally

Run `python website/build.py` from the repository root, then `python -m http.server 8000 --bind 127.0.0.1 --directory website/dist`. Open http://127.0.0.1:8000. This preview supports search, downloads, and proposal previews. The source lab inputs must be committed so downloads and displayed data refer to the same snapshot.

Target search uses concepts recorded in the repository's mappings and the approved Danish-specific reference subsets. Contributors can search Athena on its own website and enter another concept ID. Such targets are flagged for maintainer verification. Full Athena vocabulary extracts must remain outside the public repository and website assets. The Conditions reference is restricted to codes evidenced in the Danish inputs and labels for targets used by the Danish custom mappings; the full local reference is excluded from Git and deployment.

## Drugs and vaccines

The Drugs & vaccines navigation provides medication product and ingredient review, vaccine preparation review, and administration route review. Each section supports source search, target search, review filters, detail pages, corrections, and proposals for source items without usable published targets. Medication search includes ATC codes, formulations and ingredient details from the copied DKMA working export. Vaccine details retain original code/preparation combinations, Danish and English names, and historical frequencies. Multiple targets for a source remain separate mapping records.

The medication backlog reconciles published gaps and historical `Unmapped` or `Incomplete` product records with all positive targets in `stcm_vnr.csv`. Ingredient gaps come from that published mapping file. Vaccine gaps are original DDV preparation rows without a match on composite code, English preparation and frequency. This match identifies candidates for review and requires source identity confirmation. Additional vaccine proposals remain separate from published mappings and can be filtered using `Needs review`. Route values containing text in the target ID field are preserved for review and treated as unresolved.

Source enrichment and supporting dose form, unit and ingredient decisions come from `Drugs (Medications and Vaccines)/reference_data`. Target metadata comes from those authorized mapping files, including historical target details where available. Missing target names remain explicitly unavailable. Historical reference validity and mapping statuses do not certify current OMOP validity. Frequencies are never summed across repeated mapping rows.

Lab data remains in `dist/data.json`. Drug data is loaded separately from `dist/drugs.json` when needed. The server validates drug submissions using the smaller `dist/drug-proposals.json`, generated from the same records. Drug proposals carry a source item identifier, source name, preparation, and original file/record identity. Existing Measurements links and submissions remain supported.

After building, run `python -m unittest discover -s website -p 'test_*.py'` and `node --test website/test_drugs.mjs website/test_caresites.mjs` for terminology history, reference publication boundaries, source-identity, reconciliation, navigation, proposal and Measurements compatibility checks. The UI checks exercise page construction and form previews without a browser.

## Procedures

The Procedures section groups `Procedures/NCSP_SKS_mappings.csv` by Danish SKS code. Each target retains its domain, review status, equivalence, notes and original data record number. The grouped proposal form supports additions, replacements and removals. Reviewers can state whether targets are complementary or alternatives and explain the intended interpretation in the issue.

The unmapped list combines K operation codes that were active in `SKScomplete.txt` and eligible in `proc.opr` on 6 November 2026 with every observed code in `Procedures/procedure_source_code_counts.csv`. It excludes codes with positive targets in the published mapping file, including targets still marked unchecked. A scope filter separates current operations from additional observed codes (including historical codes and non-K codes). Missing terminology does not hide observed codes. Supplementary Danish and English labels come from `sks_K_codes.csv` in the DNPR catalogue.

Commit the three original terminology files under `Procedures`: `SKScomplete.txt`, `OPRklass_1995.txt` and `SGDklass_ICD8.txt`. The build reads their fixed-width Windows-1252 records across all classifications, retaining exact codes (including leading zeroes), labels, validity, last-change dates, classification and file provenance. Current SKS takes precedence over historical files. A single active classification takes precedence over earlier classifications of the same code; genuinely ambiguous matches are flagged. Historical parent labels use the child's historical validity period. Prefix parents are explicitly labelled as inferred. No code prefixes or spelling corrections are invented. Checksums of all three files are included in the catalogue. These raw dumps are build inputs and are not copied into the deployed site.

Review and unmapped lists default to descending source frequency, with code sorting also available. Source details and semicolon CSV templates retain the combined frequency and counts by table from `procedure_counts_by_table.csv`. Counts are source rows before patient/visit/date linkage, not distinct patients or deduplicated events. Overlapping extracts can count an event more than once. Suppressed values such as `<5` are preserved verbatim and sorted after exact counts; missing counts sort last and remain blank in downloads. Table totals are checked against combined totals when all values are exact. `diagnosis_source_code_counts.csv` is deliberately excluded: diagnoses require separate decisions about which represent procedures, rather than treating every diagnosis as a procedure. No fixed code allowlist is applied to the direct procedure counts.

The browser and submission endpoint use the compact `procedures.json` search index. `public/procedure_data.mjs` expands its positional rows into source identities without downloading the full details. Opening a code fetches one group of up to 128 source records, cached for the session. A bulk CSV download fetches the complete catalogue only on demand and preserves all available source details and per-table counts. Failed requests can be retried. Detail and export URLs contain a content hash and use immutable caching; the index revalidates on subsequent visits. Cloudflare provides automatic HTTP compression; no browser ZIP processing or manual gzip headers are needed. The build rejects generated procedure assets larger than 25 MiB.

To refresh the catalogue, download [SKScomplete.txt](https://filer.sundhedsdata.dk/sks/data/skscomplete/SKScomplete.txt) and the corresponding [versioned SKS code-list ZIP](https://filer.sundhedsdata.dk/sks/data/sks_xml/kodelister/). Run the importer with those files and the desired eligibility date. The original September 2026 release used the following command.

```sh
python website/import_sks.py SKScomplete.txt 20260917_SKSkodelister.zip 2026-11-06 Procedures/sks_operations.json
```

## Conditions

Conditions groups all 525 original `Conditions/stcm_dacICD10.csv` rows by their 454 Danish ICD-10 codes, retaining duplicate rows, multiple targets, non-SNOMED vocabularies, mapping validity and source-to-concept metadata. The default review view shows custom mappings; the origin filter also exposes standard-reference-only codes. Details separate custom targets from standard reference targets. Proposals add, replace or remove custom mapping rows and include the standard reference as context for an override. No review status or target domain is inferred from a positive ID. Names unavailable in the supplied files are explicitly marked; all positive IDs link to Athena.

SKS diagnosis identifiers such as `DC209M` join to dotted custom codes such as `C20.9M` by removing the SKS diagnosis prefix and inserting the ICD decimal after three characters. Lookup details retain the SKS identifier and observed raw spellings. Other observed spellings remain unchanged. Diagnosis terminology matches are restricted to diagnosis records. Frequencies come from `Procedures/diagnosis_source_code_counts.csv`, preserve suppressed values, and count source rows rather than patients. Duplicate report rows containing suppression have no invented combined frequency.

The private original `icd10_to_standard.csv` is copied to the ignored `Conditions/private_reference/` directory. To regenerate the publishable references, run:

```sh
python website/filter_condition_reference.py Conditions/private_reference/icd10_to_standard.csv
```

Commit the resulting `Conditions/reference_data/icd10_standard_for_danish_codes.csv` and `custom_target_labels.csv`. The first contains only exact source-code matches to valid SKS-style diagnosis codes observed in the Danish counts or codes in the Danish custom mapping file. The second contains only target IDs, names and vocabularies for concepts used by the custom mappings, without unrelated source rows. The build checks these boundaries and records checksums. It uses only these committed subsets, so CI does not need the private original. The supplied reference has neither a source-vocabulary column nor release/validity metadata and includes ICD10-CM-style codes. Coverage therefore means an exact match in this supplied reference, not verified current ICD10-only coverage.

**Suggest new mappings** defaults to observed codes without an active custom mapping or an exact reference match. Other coverage options expose standard-reference matches for proposing custom overrides. CSV downloads follow the current search and coverage filters, retain the coverage context and end with an empty `OMOP_concept_id`. Bulk and individual issues state that changes apply to the custom mappings. The compact conditions index, content-addressed detail groups, on-demand export and caching follow the procedure design; full reference rows are loaded only with a detail group. Full private extracts are never deployed.

## Care sites

Care sites has contextual navigation for SOR organisations, legacy departments, and the place-of-service-to-Visit crosswalk. Review filters separate mapping method, human verification and data-quality flags. Manual SOR classifications are `Verified_By=Tomer`, keyword rules are `Keyword`, and LLM results have blank verification (confirmed against the ETL pipeline). Unchecked Usagi rows are kept under legacy departments with unspecified origin. The legacy file is retained because the ETL consumes it and it contains approved mappings. No positive target or `<auto>` creator is treated as evidence of human or LLM review.

The importer joins the classification and resolved target files by exact SOR ID, preserving the 1,026 unresolved organisations for new proposals. Separately, the crosswalk suggestion list includes 118 observed SOR/legacy target concepts without a downstream Visit mapping and cites where each was used. It flags disagreement between predicted categories and recorded IDs, conflicting crosswalk labels and downstream Visit types, and scientific-notation legacy codes. It does not repair or collapse those source records. Target labels are identified as recorded metadata; absent labels stay explicitly unknown. SOR / department sources are tinted red, OMOP targets blue; the OMOP-to-OMOP crosswalk uses blue for both sides. Supporting SHAK history retains duplicate and unnamed columns and labels prefix matches rather than asserting exact department locations.

`caresites.json` contains a small manifest, provenance checksums, target metadata and download links. Compact search indexes load only for the selected coding context. On-demand details use 1,024 snapshot-addressed groups. The SOR list is approximately 2.5 MB with gzip; full LLM justifications do not load with search. A separate unresolved-only export supplies the semicolon CSV template. For bulk submissions, 32 small validation groups per coding context are read in batches of four so the Worker does not parse the entire SOR catalogue. A single proposal needs only one detail group. The normal spam controls, rate limit, deduplication and public CSV-attachment workflow apply without a new migration.

Run `python -m unittest discover -s website -p 'test_*.py'` and `node --test website/test_drugs.mjs website/test_caresites.mjs` after building. The care-site checks cover provenance, source-system identity, unresolved membership, original row selection, scientific notation, crosswalk conflicts, source histories, detail retries, single proposals and bulk previews/submissions. CI runs both suites before deployment. Include the new care-site importer, browser modules and tests when committing; generated assets stay ignored.

## Bulk proposals

Use **Download unmapped codes (CSV)** on an unmapped list to export the full backlog for that category. The UTF-8 CSV uses semicolons and ends with an empty `OMOP_concept_id` column. Fill in the targets you want to propose and retain the `source_item_id` column to distinguish source records that share a code.

Open **Upload bulk changes** for NPU, DNK, medication products, medication ingredients, vaccines, administration routes or SKS operations. Upload a CSV, TSV or TXT file of up to 16 MiB with up to 250 filled targets. Rows with blank targets are skipped. The screen detects commas, semicolons and tabs in the first row outside quoted fields, then falls back to spaces. The delimiter and whether the first row contains headers can be changed. Quote values containing spaces when using a space-delimited file. UTF-8 and Windows-1252 files are supported.

Choose the Danish source code and proposed OMOP concept ID columns. Use `source_item_id` for unmapped exports or `mapping_id` for corrections. When a code matches several records, select the intended source record from the validation table. Enter a justification for the batch and preview the issue. The original file is processed in the browser. The site submits only the selected identifiers and justification, and the Worker regenerates a normalized CSV with the current and proposed IDs and mapping provenance. The public issue links to that CSV on the Explorer. The CSV becomes downloadable once GitHub confirms issue creation.

Apply D1 migration `0002_bulk_files.sql` before deploying this version. For the current configuration, run `npx wrangler d1 migrations apply omop_mapping_submissions --remote` from the `website` directory. The migration adds the CSV to the existing submission receipt table. The existing GitHub App permissions, Turnstile checks and rate limits support bulk submissions. Keep the D1 database available for links in existing issues. The test suite covers delimiter parsing, column selection, ambiguous records, bulk issue creation and CSV downloads using simulated services.

## Automatic deployment from GitHub

**Production deployments use the `website-release` branch.** To publish website
or mapping changes, merge or commit the intended release to `website-release`
and push it to GitHub. Pushes to `main` or other branches do not update the live
site. Routine releases use GitHub Actions; no local Wrangler deployment is needed.

The workflow in `.github/workflows/deploy-website.yml` deploys every push to
`website-release`. It builds the website from that commit, runs the website checks,
applies pending D1 migrations, and deploys to the existing `omop-mapping-review`
Worker. Other branches do not trigger deployment.

Check **Actions > Deploy mapping website** for the deployment result. A successful
run updates https://omop-mapping-review.tsagi-006.workers.dev/.

The deployment credentials are already configured. If they need to be recreated,
open Settings > Secrets and variables > Actions in the GitHub repository and add
these repository secrets:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token restricted to the deployment
  account with Workers Scripts Edit and D1 Edit permissions. Cloudflare's
  Edit Cloudflare Workers token template is a starting point; ensure D1 Edit
  is included because the workflow applies migrations.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID (not the D1 database ID).

The existing GitHub App and Turnstile secrets stay in the Cloudflare Worker;
they do not need to be copied into GitHub. Commit the workflow, website code
(including `drugs.py` and `test_drugs.mjs`), configuration, and required public
mapping inputs to `website-release`, then push that branch. Watch the run in
the repository's Actions tab. Generated `website/dist` files and private keys
must not be committed. A failed build or check prevents migration and deployment.

## Initial Cloudflare setup / manual deployment

The following steps document initial provisioning and manual deployment for a
new installation. The existing production site is already configured; use the
`website-release` workflow above for future releases.

1. In the OHDSI Denmark GitHub organization, register a GitHub App with repository Issues read/write permission, install it on this repository only, and generate a private key. The Worker uses installation authentication. Convert the downloaded key to unencrypted PKCS#8 PEM locally if needed using `openssl pkcs8 -topk8 -nocrypt -in app-key.pem -out app-key-pkcs8.pem`.
2. In Cloudflare, create a D1 database named `danish-omop-submissions` and replace the placeholder database ID in `wrangler.toml`. Create a Turnstile widget authorized for the deployment hostname.
3. From this directory, run `npx wrangler d1 migrations apply danish-omop-submissions --remote`. Run `python build.py` and `npx wrangler deploy` to bring up the read-only site. Then set `GITHUB_APP_CLIENT_ID`, `GITHUB_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` (the complete PKCS#8 PEM), `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET` using the Cloudflare secrets UI or `npx wrangler secret put NAME`.
4. Verify search, a sample single proposal, and a small batch on a separate test deployment with its own D1 database, an authorized test repository in `GITHUB_REPOSITORY`, and matching App and Turnstile settings. Add the production credentials after that check. For the existing production site, automatic deployments are configured through the `website-release` workflow described above.

The submission endpoint uses Turnstile and a Cloudflare rate limit of five requests per minute per IP at each Cloudflare location. It stores a submission fingerprint and public issue URL in D1. If GitHub's response is ambiguous and the receipt stays pending, search recent issues for the fingerprint in the hidden submission marker. Set the recorded issue URL in D1 if found. Clear the pending entry only after confirming the issue was never created. Proposals are public, and the form does not collect contact details.
