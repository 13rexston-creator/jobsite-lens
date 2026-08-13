import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("connected drawings use one provider-neutral, revision-aware pipeline", async () => {
  const [types, adapter, sync, importer, schema, ui] = await Promise.all([
    read("app/document-sources/types.ts"), read("app/document-sources/procore.ts"),
    read("app/api/plan-library/sources/[sourceId]/sync/route.ts"),
    read("app/api/plan-library/source-documents/[documentId]/import/route.ts"),
    read("db/schema.ts"), read("app/dashboard/PlanLibrary.tsx"),
  ]);
  assert.match(types, /interface DocumentSourceAdapter/);
  for (const capability of ["listProjects", "listDocuments", "openDocument"]) assert.match(types, new RegExp(capability));
  assert.match(adapter, /per_page: "300", page: String\(page\)/);
  assert.match(adapter, /if \(batch\.length < 300\) break/);
  assert.match(sync, /externalRevision !== document\.revision/);
  assert.match(sync, /fileId: revisionChanged \? null/);
  assert.match(importer, /adapter\.openDocument/);
  assert.match(importer, /requirePlanStorage\(\)\.put/);
  assert.match(importer, /status: "stored"/);
  assert.doesNotMatch(importer, /pdf_url/);
  assert.match(schema, /export const documentSources/);
  assert.match(schema, /export const sourceDocuments/);
  assert.match(ui, /Manual uploads and connected drawings use the same Jobsite Lens plan index and visual engine/);
});

test("connected-source routes remain owner scoped and tokens stay server-side", async () => {
  const [sources, sync, importer, procore] = await Promise.all([
    read("app/api/plan-library/sources/route.ts"), read("app/api/plan-library/sources/[sourceId]/sync/route.ts"),
    read("app/api/plan-library/source-documents/[documentId]/import/route.ts"), read("app/procore.ts"),
  ]);
  assert.match(sources, /getOwnedPlanProject/);
  assert.match(sources, /getOwnedPlanProject\(user, projectId\)/);
  assert.match(sync, /eq\(documentSources\.ownerUserId, user\.userId\)/);
  assert.match(importer, /eq\(sourceDocuments\.ownerUserId, user\.userId\)/);
  assert.match(importer, /eq\(documentSources\.ownerUserId, user\.userId\)/);
  assert.match(procore, /encryptToken/);
  assert.doesNotMatch(sources + sync + importer, /accessToken|refreshToken|clientSecret/);
});
