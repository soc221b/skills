#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type BaselineConfiguration = "without_skill" | "old_skill";
type RunConfiguration = "with_skill" | BaselineConfiguration;

type EvalCase = {
  id: number;
  prompt: string;
  expected_output: string;
  files: string[];
  assertions: string[];
};

type CliArgs = {
  skillPath: string | null;
  workspace: string | null;
  iteration: number | null;
  baseline: BaselineConfiguration;
  oldSkillPath: string | null;
};

type ClaudeRunResult = {
  duration_ms: number;
  exit_code: number | null;
  stderr: string;
  total_tokens: number | null;
};

const claudeModel = "claude-sonnet-4-6";
const claudeEffort = "medium";
const evalsFileName = path.join("evals", "evals.json");

function usage(): void {
  console.log(`Usage: scripts/run_skill_evals.ts <skill-path> [options]

Runs each documented eval once with the skill and once with a baseline.

Options:
  --workspace <dir>    Workspace root (default: sibling <skill-name>-workspace)
  --iteration <n>      Iteration number (default: next available)
  --baseline <mode>    Baseline run: without_skill or old_skill (default: without_skill)
  --old-skill-path <p> Previous skill snapshot used with --baseline old_skill
  -h, --help           Show this help

Test cases are read from <skill-path>/evals/evals.json.
Runs use Claude Code with --model ${claudeModel} and --effort ${claudeEffort}.
Set SKILL_EVAL_CLAUDE_BIN to choose the executable used for isolated runs.
`);
}

function fail(message: string): never {
  throw new Error(message);
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${filePath}: ${(error as Error).message}`);
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${filePath}.tmp`, filePath);
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

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
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

function loadEvals(skillPath: string): {
  skillName: string;
  evals: EvalCase[];
} {
  const skillName = parseSkillName(skillPath);
  const evalsPath = path.join(skillPath, evalsFileName);
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
  return {
    skillName,
    evals: rawEvals.map((rawEval, index): EvalCase => {
      const label = `evals[${index}]`;
      assertRecord(rawEval, label);
      assertAllowedKeys(rawEval, label, [
        "id",
        "prompt",
        "expected_output",
        "files",
        "assertions",
      ]);

      const id = rawEval.id;
      if (typeof id !== "number" || !Number.isInteger(id)) {
        fail(`${label}.id must be a unique integer`);
      }
      if (ids.has(id)) {
        fail(`${label}.id duplicates ${id}`);
      }
      ids.add(id);

      const prompt = rawEval.prompt;
      const expectedOutput = rawEval.expected_output;
      assertString(prompt, `${label}.prompt`);
      assertString(expectedOutput, `${label}.expected_output`);

      const files = Object.hasOwn(rawEval, "files") ? rawEval.files : [];
      const assertions = Object.hasOwn(rawEval, "assertions")
        ? rawEval.assertions
        : [];
      assertStringArray(files, `${label}.files`);
      assertStringArray(assertions, `${label}.assertions`);

      files.forEach((file, fileIndex) => {
        validateInputFilePath(skillPath, file, `${label}.files[${fileIndex}]`);
      });

      return {
        id,
        prompt,
        expected_output: expectedOutput,
        files,
        assertions,
      };
    }),
  };
}

function isBaselineConfiguration(
  value: string,
): value is BaselineConfiguration {
  return value === "without_skill" || value === "old_skill";
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    skillPath: null,
    workspace: null,
    iteration: null,
    baseline: "without_skill",
    oldSkillPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg === "--workspace") {
      args.workspace = argv[++index];
    } else if (arg === "--iteration") {
      args.iteration = Number(argv[++index]);
    } else if (arg === "--baseline") {
      const baseline = argv[++index];
      if (!baseline || !isBaselineConfiguration(baseline)) {
        fail("--baseline must be without_skill or old_skill");
      }
      args.baseline = baseline;
    } else if (arg === "--old-skill-path") {
      args.oldSkillPath = argv[++index];
    } else if (!args.skillPath) {
      args.skillPath = arg;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (!args.skillPath) {
    usage();
    process.exit(2);
  }
  if (
    args.iteration !== null &&
    (!Number.isInteger(args.iteration) || args.iteration < 1)
  ) {
    fail("--iteration must be a positive integer");
  }
  if (args.baseline === "old_skill" && !args.oldSkillPath) {
    fail("--old-skill-path is required when running old_skill");
  }

  args.skillPath = path.resolve(args.skillPath);
  args.workspace = args.workspace ? path.resolve(args.workspace) : null;
  args.oldSkillPath = args.oldSkillPath
    ? path.resolve(args.oldSkillPath)
    : null;

  return args;
}

function evalDirectoryName(evalCase: EvalCase): string {
  return `eval-${evalCase.id}`;
}

function copyInputFiles(
  sourceRoot: string,
  targetRoot: string,
  evalCase: EvalCase,
): void {
  for (const file of evalCase.files) {
    const sourceFile = path.join(sourceRoot, file);
    const targetFile = path.join(targetRoot, file);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);
  }
}

function workingDirectoryForRun({
  evalCase,
  runConfiguration,
  skillPath,
  oldSkillPath,
  runDir,
}: {
  evalCase: EvalCase;
  runConfiguration: RunConfiguration;
  skillPath: string;
  oldSkillPath: string | null;
  runDir: string;
}): string {
  if (runConfiguration === "with_skill") {
    return skillPath;
  }
  if (runConfiguration === "old_skill") {
    if (!oldSkillPath) {
      fail("--old-skill-path is required when running old_skill");
    }
    return oldSkillPath;
  }

  const inputDir = path.join(runDir, "input");
  fs.mkdirSync(inputDir, { recursive: true });
  copyInputFiles(skillPath, inputDir, evalCase);
  return inputDir;
}

function buildPrompt({
  evalCase,
  runConfiguration,
  skillPath,
  oldSkillPath,
  outputDir,
}: {
  evalCase: EvalCase;
  runConfiguration: RunConfiguration;
  skillPath: string;
  oldSkillPath: string | null;
  outputDir: string;
}): string {
  const inputFiles =
    evalCase.files.length === 0 ? "none" : evalCase.files.join(", ");
  const lines = ["Execute this task:"];

  if (runConfiguration === "with_skill") {
    lines.push(`- Skill path: ${skillPath}`);
  } else if (runConfiguration === "old_skill") {
    lines.push(`- Skill path: ${oldSkillPath}`);
  }

  lines.push(
    `- Task: ${evalCase.prompt}`,
    `- Input files: ${inputFiles}`,
    `- Save outputs to: ${outputDir}`,
  );

  return `${lines.join("\n")}\n`;
}

function nextIteration(workspace: string): number {
  if (!fs.existsSync(workspace)) {
    return 1;
  }

  const iterations = fs
    .readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const match = entry.name.match(/^iteration-(\d+)$/);
      return match ? [Number(match[1])] : [];
    });

  return iterations.length === 0 ? 1 : Math.max(...iterations) + 1;
}

function extractTotalTokens(jsonl: string): number | null {
  let found: number | null = null;
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const value = JSON.parse(line);
      found = findTokenValue(value) ?? found;
    } catch {
      // Non-JSON output is not part of Claude usage accounting.
    }
  }
  return found;
}

function findTokenValue(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (Number.isFinite(record.total_tokens)) {
    return record.total_tokens as number;
  }

  if (
    Number.isFinite(record.input_tokens) &&
    Number.isFinite(record.output_tokens)
  ) {
    return (record.input_tokens as number) + (record.output_tokens as number);
  }

  const usage = record.usage;
  if (usage && typeof usage === "object") {
    const usageRecord = usage as Record<string, unknown>;
    if (Number.isFinite(usageRecord.total_tokens)) {
      return usageRecord.total_tokens as number;
    }
    if (
      Number.isFinite(usageRecord.input_tokens) &&
      Number.isFinite(usageRecord.output_tokens)
    ) {
      return (
        (usageRecord.input_tokens as number) +
        (usageRecord.output_tokens as number)
      );
    }
  }

  for (const child of Object.values(record)) {
    const found = findTokenValue(child);
    if (found !== null) {
      return found;
    }
  }

  return null;
}

function extractClaudeOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return "";
  }

  try {
    const value = JSON.parse(trimmed);
    if (
      value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>).result === "string"
    ) {
      return `${(value as Record<string, string>).result.trimEnd()}\n`;
    }
  } catch {
    // Fall back to text or JSONL parsing below.
  }

  const parts: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (typeof value.result === "string") {
        parts.push(value.result);
        continue;
      }
      const message = value.message;
      if (!message || typeof message !== "object") {
        continue;
      }
      const content = (message as Record<string, unknown>).content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const item of content) {
        if (
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).type === "text" &&
          typeof (item as Record<string, unknown>).text === "string"
        ) {
          parts.push((item as Record<string, string>).text);
        }
      }
    } catch {
      return stdout;
    }
  }

  return parts.length === 0 ? stdout : `${parts.join("\n").trimEnd()}\n`;
}

function runClaude({
  workingDir,
  outputFile,
  outputDir,
  prompt,
}: {
  workingDir: string;
  outputFile: string;
  outputDir: string;
  prompt: string;
}): Promise<ClaudeRunResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(
      process.env.SKILL_EVAL_CLAUDE_BIN ?? "claude",
      [
        "--print",
        "--add-dir",
        outputDir,
        "--model",
        claudeModel,
        "--effort",
        claudeEffort,
        "--permission-mode",
        "bypassPermissions",
        "--output-format",
        "json",
        prompt,
      ],
      { cwd: workingDir, stdio: ["ignore", "pipe", "pipe"] },
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      stderrChunks.push(Buffer.from(`${error.message}\n`));
    });
    child.on("close", (exitCode) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      fs.writeFileSync(outputFile, extractClaudeOutput(stdout));
      resolve({
        duration_ms: Date.now() - startedAt,
        exit_code: exitCode,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        total_tokens: extractTotalTokens(stdout),
      });
    });
  });
}

async function runOneConfiguration({
  evalCase,
  evalDir,
  runConfiguration,
  skillPath,
  oldSkillPath,
}: {
  evalCase: EvalCase;
  evalDir: string;
  runConfiguration: RunConfiguration;
  skillPath: string;
  oldSkillPath: string | null;
}): Promise<number> {
  const runDir = path.join(evalDir, runConfiguration);
  const outputDir = path.join(runDir, "outputs");
  fs.mkdirSync(outputDir, { recursive: true });

  const workingDir = workingDirectoryForRun({
    evalCase,
    runConfiguration,
    skillPath,
    oldSkillPath,
    runDir,
  });
  const outputFile = path.join(outputDir, "output.md");
  const result = await runClaude({
    workingDir,
    outputFile,
    outputDir,
    prompt: buildPrompt({
      evalCase,
      runConfiguration,
      skillPath,
      oldSkillPath,
      outputDir,
    }),
  });

  writeJson(path.join(runDir, "timing.json"), {
    total_tokens: result.total_tokens,
    duration_ms: result.duration_ms,
  });

  console.log(
    `${path.basename(evalDir)} ${runConfiguration}: exit ${result.exit_code}`,
  );
  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }

  return result.exit_code ?? 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const skillPath = args.skillPath;
  if (!skillPath) {
    fail("skill path is required");
  }

  const { skillName, evals } = loadEvals(skillPath);
  const workspace =
    args.workspace ??
    path.join(path.dirname(skillPath), `${skillName}-workspace`);
  const iteration = args.iteration ?? nextIteration(workspace);
  const iterationDir = path.join(workspace, `iteration-${iteration}`);
  if (fs.existsSync(iterationDir)) {
    fail(`${iterationDir} already exists; use the next iteration directory`);
  }

  fs.mkdirSync(iterationDir, { recursive: true });
  const runConfigurations: RunConfiguration[] = ["with_skill", args.baseline];
  let exitCode = 0;

  for (const evalCase of evals) {
    const evalDir = path.join(iterationDir, evalDirectoryName(evalCase));
    fs.mkdirSync(evalDir, { recursive: true });

    for (const runConfiguration of runConfigurations) {
      const runExitCode = await runOneConfiguration({
        evalCase,
        evalDir,
        runConfiguration,
        skillPath,
        oldSkillPath: args.oldSkillPath,
      });
      if (runExitCode !== 0) {
        exitCode = runExitCode;
      }
    }
  }

  console.log(`Saved eval workspace: ${iterationDir}`);
  console.log(
    "Next: grade each run into grading.json, then aggregate benchmark.json.",
  );
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`ERROR: ${(error as Error).message}`);
    process.exit(1);
  });
}
