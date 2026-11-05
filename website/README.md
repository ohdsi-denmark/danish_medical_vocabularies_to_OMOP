# Danish OMOP Mapping Explorer

The NPU/DNK pilot uses the lab files in this repository. The public site builds a versioned search snapshot and links to the corresponding original GitHub downloads. Public submissions open issues in the same repository.

The national BRUGSNAVN and NPUBEGREB exports dated 30 October 2026 enrich mapped and backlog codes by exact DNK/NPU code. The importer preserves every national name, both abbreviated and full concept properties, inactive status, and replacement references. Danish names and definitions are searchable. The existing frequency report determines the backlog membership. Missing terminology entries remain visible with an explicit fallback. Source definition markup is converted to plain text, with superscripts represented as `^(...)` and subscripts as `_(...)`. National terminology dates retain the source's date and time without assuming a time zone.

## Preview locally

Run `python website/build.py` from the repository root, then `python -m http.server 8000 --bind 127.0.0.1 --directory website/dist`. Open http://127.0.0.1:8000. This preview supports search, downloads, and proposal previews. The source lab inputs must be committed so downloads and displayed data refer to the same snapshot.

Target search uses only concepts already recorded in the repository's mapping files. Contributors can search Athena on its own website and enter another concept ID. Such targets are flagged for maintainer verification. Athena vocabulary extracts must remain outside the public repository and website assets. The website builder does not import these extracts.

## Deploy on Cloudflare Workers

1. In the OHDSI Denmark GitHub organization, register a GitHub App with repository Issues read/write permission, install it on this repository only, and generate a private key. The Worker uses installation authentication. Convert the downloaded key to unencrypted PKCS#8 PEM locally if needed using `openssl pkcs8 -topk8 -nocrypt -in app-key.pem -out app-key-pkcs8.pem`.
2. In Cloudflare, create a D1 database named `danish-omop-submissions` and replace the placeholder database ID in `wrangler.toml`. Create a Turnstile widget authorized for the deployment hostname.
3. From this directory, run `npx wrangler d1 migrations apply danish-omop-submissions --remote`. Run `python build.py` and `npx wrangler deploy` to bring up the read-only site. Then set `GITHUB_APP_CLIENT_ID`, `GITHUB_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` (the complete PKCS#8 PEM), `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET` using the Cloudflare secrets UI or `npx wrangler secret put NAME`.
4. Verify search, a sample single proposal, and a small batch on a separate test deployment with its own D1 database, an authorized test repository in `GITHUB_REPOSITORY`, and matching App and Turnstile settings. Add the production credentials after that check. Configure a deployment build on mapping releases once the snapshot and issue flow have been checked.

The submission endpoint uses Turnstile and a Cloudflare rate limit of five requests per minute per IP at each Cloudflare location. It stores a submission fingerprint and public issue URL in D1. If GitHub's response is ambiguous and the receipt stays pending, search recent issues for the fingerprint in the hidden submission marker. Set the recorded issue URL in D1 if found. Clear the pending entry only after confirming the issue was never created. Proposals are public, and the form does not collect contact details.
