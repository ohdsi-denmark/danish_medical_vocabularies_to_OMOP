# Danish OMOP Mapping Explorer

The explorer uses the lab, medication, vaccine and administration route mapping files in this repository. It builds versioned search snapshots and links to the corresponding original GitHub downloads. Public submissions open issues in the same repository.

The national BRUGSNAVN and NPUBEGREB exports dated 30 October 2026 enrich mapped and backlog codes by exact DNK/NPU code. The importer preserves every national name, both abbreviated and full concept properties, inactive status, and replacement references. Danish names and definitions are searchable. The existing frequency report determines the backlog membership. Missing terminology entries remain visible with an explicit fallback. Source definition markup is converted to plain text, with superscripts represented as `^(...)` and subscripts as `_(...)`. National terminology dates retain the source's date and time without assuming a time zone.

## Preview locally

Run `python website/build.py` from the repository root, then `python -m http.server 8000 --bind 127.0.0.1 --directory website/dist`. Open http://127.0.0.1:8000. This preview supports search, downloads, and proposal previews. The source lab inputs must be committed so downloads and displayed data refer to the same snapshot.

Target search uses only concepts already recorded in the repository's mapping files. Contributors can search Athena on its own website and enter another concept ID. Such targets are flagged for maintainer verification. Athena vocabulary extracts must remain outside the public repository and website assets. The website builder does not import these extracts.

## Drugs and vaccines

The Drugs & vaccines navigation provides medication product and ingredient review, vaccine preparation review, and administration route review. Each section supports source search, target search, review filters, detail pages, corrections, and proposals for source items without usable published targets. Medication search includes ATC codes, formulations and ingredient details from the copied DKMA working export. Vaccine details retain original code/preparation combinations, Danish and English names, and historical frequencies. Multiple targets for a source remain separate mapping records.

The medication backlog reconciles published gaps and historical `Unmapped` or `Incomplete` product records with all positive targets in `stcm_vnr.csv`. Ingredient gaps come from that published mapping file. Vaccine gaps are original DDV preparation rows without a match on composite code, English preparation and frequency. This match identifies candidates for review and requires source identity confirmation. Additional vaccine proposals remain separate from published mappings and can be filtered using `Needs review`. Route values containing text in the target ID field are preserved for review and treated as unresolved.

Source enrichment and supporting dose form, unit and ingredient decisions come from `Drugs (Medications and Vaccines)/reference_data`. Target metadata comes from those authorized mapping files, including historical target details where available. Missing target names remain explicitly unavailable. Historical reference validity and mapping statuses do not certify current OMOP validity. Frequencies are never summed across repeated mapping rows.

Lab data remains in `dist/data.json`. Drug data is loaded separately from `dist/drugs.json` when needed. The server validates drug submissions using the smaller `dist/drug-proposals.json`, generated from the same records. Drug proposals carry a source item identifier, source name, preparation, and original file/record identity. Existing Measurements links and submissions remain supported.

After building, run `node --test website/test_drugs.mjs` for source-identity, reconciliation, navigation, proposal and Measurements compatibility checks. The UI checks exercise page construction and form previews without a browser.

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
