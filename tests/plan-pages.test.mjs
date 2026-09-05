import assert from "node:assert/strict";
import test from "node:test";
import { parseByteRange } from "../app/http-range.ts";
import { isCandidatePageText } from "../app/plan-pages.ts";

test("parses single HTTP byte ranges used by PDF readers", () => {
  assert.deepEqual(parseByteRange("bytes=0-9", 100), { kind: "range", start: 0, end: 9, length: 10 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { kind: "range", start: 90, end: 99, length: 10 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { kind: "range", start: 90, end: 99, length: 10 });
  assert.deepEqual(parseByteRange("bytes=90-200", 100), { kind: "range", start: 90, end: 99, length: 10 });
  assert.deepEqual(parseByteRange(null, 100), { kind: "none" });
  assert.deepEqual(parseByteRange("items=0-9", 100), { kind: "none" });
  assert.deepEqual(parseByteRange("bytes=0-1,5-6", 100), { kind: "none" });
});

test("rejects invalid or unsatisfiable HTTP byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=100-", 100), { kind: "invalid" });
  assert.deepEqual(parseByteRange("bytes=20-10", 100), { kind: "invalid" });
  assert.deepEqual(parseByteRange("bytes=-0", 100), { kind: "invalid" });
});

test("conservatively identifies fixture-count candidate pages from extracted text", () => {
  assert.equal(isCandidatePageText(""), true);
  assert.equal(isCandidatePageText("LEVEL 2 FLOOR PLAN"), true);
  assert.equal(isCandidatePageText("PLUMBING FIXTURE SCHEDULE"), true);
  assert.equal(isCandidatePageText("UNIT MATRIX AND UNIT PLAN"), true);
  assert.equal(isCandidatePageText("KITCHEN SINK AND LAVATORY"), true);
  assert.equal(isCandidatePageText("GENERAL STRUCTURAL NOTES"), false);
});
