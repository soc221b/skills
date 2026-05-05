#!/usr/bin/env node

import fs from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

type EvalCase = {
  id: number;
  prompt: string;
  expected_output: string;
  files: string[];
  assertions: string[];
};

function usage(): void {
  console.log(`Usage: scripts/validate_skill_evals.ts

Validates every skill directory with evals/evals.json under the current working directory.

Options:
  -h, --help  Show this help
`);
}

function fail(message: string): never {
  throw new Error(message);
}

const green = "\u001B[32m";
const red = "\u001B[31m";
const gray = "\u001B[90m";
const reset = "\u001B[0m";
const resetColor = "\u001B[39m";

function formatPassDots(count: number): string {
  const dot = process.stdout.isTTY ? `${green}.${reset}` : ".";
  return `${dot.repeat(count)}\n`;
}

function formatFailure(error: Error, durationMs: number): string {
  const duration = `${durationMs.toFixed(6)}ms`;
  const details = (error.stack ?? `Error: ${error.message}`)
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");

  if (process.stdout.isTTY) {
    return `${red}X${reset}\n\n${red}Failed tests:${resetColor}\n\n${red}✖ validate_skill_evals ${gray}(${duration})${resetColor}${resetColor}\n${details}\n`;
  }

  return `X\n\nFailed tests:\n\n✖ validate_skill_evals (${duration})\n${details}\n`;
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${filePath}: ${(error as Error).message}`);
  }
}

function parseSkillName(skillPath: string): string {
  const skillFile = path.join(skillPath, "SKILL.md");
  const contents = fs.readFileSync(skillFile, "utf8");
  const match = contents.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    fail(`${skillFile}: missing YAML frontmatter`);
  }

  const nameLine = match[1]
    .split(/\r?\n/)
    .find((line) => line.startsWith("name:"));

  if (!nameLine) {
    fail(`${skillFile}: missing frontmatter name`);
  }

  return nameLine.replace(/^name:\s*/, "").trim();
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
}

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  label: string,
  allowedKeys: string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(`${label}.${key} is not defined by the skill evals schema`);
    }
  }
}

function assertStringArray(
  value: unknown,
  label: string,
): asserts value is string[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      fail(`${label}[${index}] must be a non-empty string`);
    }
  });
}

function validateInputFilePath(
  skillPath: string,
  file: string,
  label: string,
): void {
  if (path.isAbsolute(file)) {
    fail(
      `${label} must be a relative path inside the skill directory: ${file}`,
    );
  }

  const skillRoot = path.resolve(skillPath);
  const resolved = path.resolve(skillRoot, file);
  const relativeToSkill = path.relative(skillRoot, resolved);
  if (relativeToSkill.startsWith("..") || path.isAbsolute(relativeToSkill)) {
    fail(`${label} must stay inside the skill directory: ${file}`);
  }

  if (!fs.existsSync(resolved)) {
    fail(`${label} references missing file: ${file}`);
  }
}

export function loadAndValidateEvals(skillPath: string): EvalCase[] {
  const evalsPath = path.join(skillPath, "evals", "evals.json");
  const skillName = parseSkillName(skillPath);
  const evalsJson = readJson(evalsPath);

  assertRecord(evalsJson, evalsPath);
  assertAllowedKeys(evalsJson, evalsPath, ["skill_name", "evals"]);
  const evalFileSkillName = evalsJson.skill_name;
  assertString(evalFileSkillName, `${evalsPath}.skill_name`);
  if (evalFileSkillName !== skillName) {
    fail(
      `${evalsPath}: skill_name "${evalFileSkillName}" does not match SKILL.md name "${skillName}"`,
    );
  }

  const rawEvals = evalsJson.evals;
  if (!Array.isArray(rawEvals) || rawEvals.length === 0) {
    fail(`${evalsPath}: evals must be a non-empty array`);
  }

  const ids = new Set<number>();
  return rawEvals.map((evalCase, index): EvalCase => {
    const label = `evals[${index}]`;

    assertRecord(evalCase, label);
    assertAllowedKeys(evalCase, label, [
      "id",
      "prompt",
      "expected_output",
      "files",
      "assertions",
    ]);

    const id = evalCase.id;
    if (typeof id !== "number" || !Number.isInteger(id)) {
      fail(`${label}.id must be a unique integer`);
    }
    if (ids.has(id)) {
      fail(`${label}.id duplicates ${id}`);
    }
    ids.add(id);

    const prompt = evalCase.prompt;
    const expectedOutput = evalCase.expected_output;
    assertString(prompt, `${label}.prompt`);
    assertString(expectedOutput, `${label}.expected_output`);
    const files = Object.hasOwn(evalCase, "files") ? evalCase.files : [];
    const assertions = Object.hasOwn(evalCase, "assertions")
      ? evalCase.assertions
      : [];
    assertStringArray(files, `${label}.files`);
    assertStringArray(assertions, `${label}.assertions`);

    for (const [fileIndex, file] of files.entries()) {
      validateInputFilePath(skillPath, file, `${label}.files[${fileIndex}]`);
    }

    return {
      id,
      prompt,
      expected_output: expectedOutput,
      files,
      assertions,
    };
  });
}

function hasSkillEvalFile(directory: string): boolean {
  return (
    fs.existsSync(path.join(directory, "SKILL.md")) &&
    fs.existsSync(path.join(directory, "evals", "evals.json"))
  );
}

export function findSkillDirs(rootPath: string): string[] {
  const resolvedRoot = path.resolve(rootPath);
  const skillDirs: string[] = [];

  function visit(directory: string): void {
    if (hasSkillEvalFile(directory)) {
      skillDirs.push(directory);
      return;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (
        [".git", "node_modules"].includes(entry.name) ||
        entry.name.endsWith("-workspace")
      ) {
        continue;
      }
      visit(path.join(directory, entry.name));
    }
  }

  visit(resolvedRoot);
  return [...new Set(skillDirs)].sort();
}

export function validateAllSkillEvals(rootPath: string): number {
  const skillDirs = findSkillDirs(rootPath);
  if (skillDirs.length === 0) {
    fail(`${path.resolve(rootPath)}: no skill eval files found`);
  }

  for (const skillPath of skillDirs) {
    loadAndValidateEvals(skillPath);
  }
  return skillDirs.length;
}

export function main(
  argv = process.argv.slice(2),
  rootPath = process.cwd(),
): void {
  const startedAt = performance.now();

  try {
    if (argv.some((arg) => arg === "-h" || arg === "--help")) {
      usage();
      process.exit(0);
    }
    if (argv.length > 0) {
      fail(`Unexpected argument: ${argv.join(" ")}`);
    }

    process.stdout.write(formatPassDots(validateAllSkillEvals(rootPath)));
  } catch (error) {
    const caughtError =
      error instanceof Error ? error : new Error(String(error));
    process.stdout.write(
      formatFailure(caughtError, performance.now() - startedAt),
    );
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
