import { procedureProposal, proposal } from "./public/proposal.mjs";
import { bulkProposal } from "./public/bulk.mjs";
import { expandProcedures } from "./public/procedure_data.mjs";
import { careSubmissionData } from "./public/care_data.mjs";

const encoder = new TextEncoder();
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error, status) => json({ error }, status);

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function githubToken(env) {
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(
    atob(env.GITHUB_APP_PRIVATE_KEY.replace(/-----[^-]+-----|\s/g, "")), char => char.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const jwt = [JSON.stringify({ alg: "RS256", typ: "JWT" }),
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_CLIENT_ID })]
    .map(part => base64url(encoder.encode(part))).join(".");
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(jwt));
  const response = await github(`app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
    `${jwt}.${base64url(new Uint8Array(signature))}`,
    { repositories: [env.GITHUB_REPOSITORY.split("/")[1]], permissions: { issues: "write" } });
  if (!response.ok) throw new Error(`GitHub authentication returned ${response.status}`);
  return (await response.json()).token;
}

function github(path, token, payload) {
  return fetch(`https://api.github.com/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
      "Content-Type": "application/json", "User-Agent": "Danish-OMOP-Mapping-Explorer",
    },
    body: JSON.stringify(payload),
  });
}

async function boundedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body");
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return JSON.parse(body + decoder.decode());
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      throw new Error("Request exceeds maximum size");
    }
    body += decoder.decode(value, { stream: true });
  }
}

async function submit(request, env) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("Origin") !== origin) return fail("Submit from the mapping explorer.", 403);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await env.PROPOSAL_RATE.limit({ key: ip })).success) return fail("Too many attempts. Wait a minute and try again.", 429);
  let input;
  try {
    input = await boundedJson(request);
  } catch {
    return fail("The proposal is too large or could not be read.", 400);
  }
  if (typeof input?.token !== "string" || !input.token || input.token.length > 2048) {
    return fail("Complete the spam check and try again.", 400);
  }
  const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: input.token, remoteip: ip }),
  }).then(response => response.json());
  if (!verification.success || verification.action !== "mapping_proposal" || verification.hostname !== new URL(origin).hostname) {
    return fail("The spam check expired or failed. Please try again.", 400);
  }
  const collections = { labs: "/data.json", drugs: "/drug-proposals.json", procedures: "/procedures.json", conditions: "/conditions.json", caresites: "/caresites.json" };
  const dataset = input.dataset || "labs";
  if (!Object.hasOwn(collections, dataset)) return fail("Unknown mapping collection.", 400);
  const filename = collections[dataset];
  let data = expandProcedures(await env.ASSETS.fetch(new URL(filename, origin)).then(response => response.json()));
  let issue;
  try {
    if (dataset === "caresites") data = await careSubmissionData(data, input, async path => {
      const response = await env.ASSETS.fetch(new URL(path, origin));
      if (!response.ok) throw new Error("Care-site source records could not be loaded.");
      return response.json();
    });
    if (input.bulk !== undefined) issue = bulkProposal(data, input);
    else if (["procedures", "conditions", "caresites"].includes(dataset)) issue = procedureProposal(data, input);
    else issue = proposal(data, input);
  } catch (error) {
    return fail(error.message, 400);
  }
  const fingerprint = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256",
    encoder.encode(issue.csv ? `${issue.body}\n\n${issue.csv}` : issue.body))));
  const db = env.SUBMISSIONS;
  const existing = () => db.prepare("SELECT issue_url FROM submissions WHERE fingerprint = ?").bind(fingerprint).first();
  const receipt = row => row?.issue_url ? json({ url: row.issue_url }) :
    fail(`This proposal is already being processed. Try again later. Reference: ${fingerprint}`, 409);
  const previous = await existing();
  if (previous) return receipt(previous);
  const token = await githubToken(env);
  const claim = issue.csv
    ? await db.prepare("INSERT OR IGNORE INTO submissions (fingerprint, bulk_csv) VALUES (?, ?)").bind(fingerprint, issue.csv).run()
    : await db.prepare("INSERT OR IGNORE INTO submissions (fingerprint) VALUES (?)").bind(fingerprint).run();
  if (!claim.meta.changes) return receipt(await existing());

  // Keep the claim if GitHub's result is ambiguous so retries cannot open a second issue.
  const response = await github(`repos/${env.GITHUB_REPOSITORY}/issues`, token, {
    title: issue.title,
    body: `${issue.body}${issue.csv ? `\n\n[Download mapping-proposal.csv](${origin}/api/bulk-files/${fingerprint}.csv)` : ""}\n\n<!-- submission:${fingerprint} -->`,
  });
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      await db.prepare("DELETE FROM submissions WHERE fingerprint = ?").bind(fingerprint).run();
    }
    throw new Error(`GitHub issue creation returned ${response.status}`);
  }
  const { html_url: url } = await response.json();
  if (!url?.startsWith(`https://github.com/${env.GITHUB_REPOSITORY}/issues/`)) {
    throw new Error("Unexpected GitHub issue URL");
  }
  await db.prepare("UPDATE submissions SET issue_url = ? WHERE fingerprint = ?").bind(url, fingerprint).run();
  return json({ url }, 201);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const attachment = /^\/api\/bulk-files\/([A-Za-z0-9_-]{43})\.csv$/.exec(pathname);
    if (attachment && request.method === "GET") {
      const record = await env.SUBMISSIONS.prepare("SELECT bulk_csv FROM submissions WHERE fingerprint = ? AND issue_url IS NOT NULL")
        .bind(attachment[1]).first();
      return record?.bulk_csv ? new Response(record.bulk_csv, { headers: {
        "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="mapping-proposal.csv"',
        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
      } }) : fail("Proposal file not found.", 404);
    }
    const ready = env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET && env.GITHUB_APP_CLIENT_ID &&
      env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_INSTALLATION_ID && env.SUBMISSIONS && env.PROPOSAL_RATE;
    if (pathname === "/api/config" && request.method === "GET") {
      return json({ siteKey: ready ? env.TURNSTILE_SITE_KEY : null });
    }
    if (pathname === "/api/proposals" && request.method === "POST") {
      if (!ready) return fail("Public submissions are not configured.", 503);
      try {
        return await submit(request, env);
      } catch (error) {
        console.error("Proposal failed:", error.message);
        return fail("The submission service could not confirm your issue. Please try again later.", 503);
      }
    }
    return fail("Endpoint not found.", 404);
  },
};
