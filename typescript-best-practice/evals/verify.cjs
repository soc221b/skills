#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const explicitAvailableAssertion =
  'The output shows explicit `case "connected"` and `case "ready"` branches that return `Available`.';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const evalsJsonPath = argValue("--evals-json");
const evalId = Number(argValue("--eval-id"));
const outputDir = argValue("--output-dir");

if (!evalsJsonPath || !Number.isInteger(evalId) || !outputDir) {
  fail("Usage: verify.cjs --evals-json <path> --eval-id <id> --output-dir <dir>");
}

const evalsJson = JSON.parse(fs.readFileSync(evalsJsonPath, "utf8"));
const evalCase = evalsJson.evals.find((candidate) => candidate.id === evalId);
if (!evalCase) {
  fail(`Missing eval id ${evalId}`);
}

const outputPath = path.join(outputDir, "output.md");
const output = fs.existsSync(outputPath)
  ? fs.readFileSync(outputPath, "utf8")
  : "";

const assertionResults = [];
if (evalCase.assertions.includes(explicitAvailableAssertion)) {
  const hasConnectedCase = /\bcase\s+["']connected["']\s*:/.test(output);
  const hasReadyCase = /\bcase\s+["']ready["']\s*:/.test(output);
  const hasAvailableReturn = /\breturn\s+["']Available["']/.test(output);
  assertionResults.push({
    text: explicitAvailableAssertion,
    passed: hasConnectedCase && hasReadyCase && hasAvailableReturn,
    evidence:
      'Checked for explicit case "connected" and case "ready" branches returning Available.',
  });
}

process.stdout.write(`${JSON.stringify({ assertion_results: assertionResults })}\n`);
