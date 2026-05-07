#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type BaselineConfiguration = "without_skill" | "old_skill";
type AgentProvider = "claude" | "codex";
type RunConfiguration = "with_skill" | BaselineConfiguration;

type EvalCase = {
  id: number;
  prompt: string;
  expected_output?: string;
  files: string[];
  assertions: string[];
};

type CliArgs = {
  skillPath: string | null;
  workspace: string | null;
  iteration: number | null;
  baseline: BaselineConfiguration;
  oldSkillPath: string | null;
  model: string;
  effort: string;
};

type AgentRunRequest = {
  addDirs: string[];
  effort: string;
  model: string;
  workingDir: string;
  prompt: string;
};

type AgentRunResult = {
  duration_ms: number;
  exit_code: number | null;
  output: string;
  stderr: string;
  stdout: string;
  total_tokens: number | null;
};

type AgentAdapter = {
  invoke(request: AgentRunRequest): Promise<AgentRunResult>;
  provider: AgentProvider;
};

type AssertionResult = {
  text: string;
  passed: boolean;
  evidence: string;
};

type GradingJson = {
  assertion_results: AssertionResult[];
  summary: {
    passed: number;
    failed: number;
    total: number;
    pass_rate: number | null;
  };
};

type RunStats = {
  failed: number;
  pass_rate: number | null;
  passed: number;
  time_seconds: number;
  tokens: number;
  total: number;
};

type BenchmarkMetric = {
  mean: number | null;
  stddev: number | null;
};

type BenchmarkConfigurationSummary = {
  pass_rate: BenchmarkMetric;
  time_seconds: BenchmarkMetric;
  tokens: BenchmarkMetric;
};

type OldSkillSnapshot = {
  path: string;
  provenance: "copied_from_supplied_snapshot" | "existing_workspace_snapshot";
  source_path: string;
};

type RunTask = {
  evalCase: EvalCase;
  evalDir: string;
  runConfiguration: RunConfiguration;
};

type RunOutcome = {
  exitCode: number;
};

type GradeOutcome = {
  status: string;
};

const defaultClaudeModel = "claude-sonnet-4-6";
const defaultClaudeEffort = "high";
const evalsFileName = path.join("evals", "evals.json");

function usage(): void {
  console.log(`Usage: scripts/run_skill_evals.ts <skill-path> [options]

Runs each documented eval once with the skill and once with a baseline, then
grades assertions, aggregates benchmark.json, and prepares feedback.json.

Options:
  --workspace <dir>    Workspace root (default: sibling <skill-name>-workspace)
  --iteration <n>      Iteration number (default: next available)
  --baseline <mode>    Baseline run: without_skill or old_skill (default: without_skill)
  --old-skill-path <p> Previous skill snapshot copied for old_skill unless workspace snapshot exists
  --model <name>       Model name (default: ${defaultClaudeModel})
  --effort <level>     Reasoning effort (default: ${defaultClaudeEffort})
  -h, --help           Show this help

Test cases are read from <skill-path>/evals/evals.json.
Claude models run with Claude Code; other models run with Codex.
Set SKILL_EVAL_CLAUDE_BIN or SKILL_EVAL_CODEX_BIN to choose the executable used for isolated runs.

Optional deterministic grading hook:
  <skill-path>/evals/verify.mjs, verify.js, or verify.cjs
  The script is invoked with --evals-json, --eval-id, --output-dir,
  --run-configuration, and --skill-path. It should print JSON containing
  assertion_results for any assertions it can verify mechanically; remaining
  assertions are LLM-graded.
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

function readJsonFile<T>(filePath: string): T {
  return readJson(filePath) as T;
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(`${filePath}.tmp`, value);
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

function assertNonEmptyStringArray(
  value: unknown,
  label: string,
): asserts value is string[] {
  assertStringArray(value, label);
  if (value.length === 0) {
    fail(`${label} must be a non-empty array`);
  }
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
      assertString(prompt, `${label}.prompt`);
      const rawExpectedOutput = Object.hasOwn(rawEval, "expected_output")
        ? rawEval.expected_output
        : undefined;
      let expectedOutput: string | undefined;
      if (rawExpectedOutput !== undefined) {
        assertString(rawExpectedOutput, `${label}.expected_output`);
        expectedOutput = rawExpectedOutput;
      }

      const files = Object.hasOwn(rawEval, "files") ? rawEval.files : [];
      const assertions = rawEval.assertions;
      assertStringArray(files, `${label}.files`);
      assertNonEmptyStringArray(assertions, `${label}.assertions`);

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
    model: defaultClaudeModel,
    effort: defaultClaudeEffort,
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
    } else if (arg === "--model") {
      args.model = argv[++index];
    } else if (arg === "--effort") {
      args.effort = argv[++index];
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
  if (!args.model || args.model.trim() === "") {
    fail("--model must be a non-empty string");
  }
  if (!args.effort || args.effort.trim() === "") {
    fail("--effort must be a non-empty string");
  }

  args.skillPath = path.resolve(args.skillPath);
  args.workspace = args.workspace ? path.resolve(args.workspace) : null;
  args.oldSkillPath = args.oldSkillPath
    ? path.resolve(args.oldSkillPath)
    : null;

  return args;
}

const slugStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "based",
  "branch",
  "case",
  "can",
  "do",
  "eval",
  "evals",
  "expected",
  "explicitly",
  "fallback",
  "file",
  "files",
  "final",
  "for",
  "formatter",
  "from",
  "handling",
  "identifies",
  "in",
  "is",
  "it",
  "issue",
  "json",
  "never",
  "not",
  "of",
  "on",
  "or",
  "other",
  "output",
  "plus",
  "read",
  "recommends",
  "reports",
  "review",
  "reviews",
  "exhaustive",
  "shows",
  "ts",
  "the",
  "this",
  "to",
  "with",
  "you",
]);

function slugWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (word) => word.length > 1 && !slugStopWords.has(word),
  );
}

function hasFileOnlyPromptShape(
  prompt: string,
  promptWords: string[],
): boolean {
  const lowerPrompt = prompt.toLowerCase();
  return (
    /(?:^|\s)(?:do not read|review)\b/.test(lowerPrompt) &&
    /(?:^|\s)(?:evals\/files\/|[\w.-]+\.(?:ts|js|tsx|jsx|md|json|csv|txt)\b)/.test(
      lowerPrompt,
    ) &&
    promptWords.length <= 2
  );
}

function evalDirectorySlug(evalCase: EvalCase): string {
  const promptWords = slugWords(evalCase.prompt);
  const semanticWords = slugWords(
    [evalCase.expected_output, ...evalCase.assertions].join(" "),
  );
  const words =
    hasFileOnlyPromptShape(evalCase.prompt, promptWords) &&
    semanticWords.length > 0
      ? semanticWords
      : promptWords.length > 0
        ? promptWords
        : semanticWords;

  return words.slice(0, 6).join("-") || "case";
}

function evalDirectoryName(evalCase: EvalCase): string {
  return `eval-${evalDirectorySlug(evalCase)}-${evalCase.id}`;
}

function runTaskLabel(
  task: Pick<RunTask, "evalDir" | "runConfiguration">,
): string {
  return `${path.basename(task.evalDir)} ${task.runConfiguration}`;
}

function taskStatusKey({
  evalCase,
  runConfiguration,
}: Pick<RunTask, "evalCase" | "runConfiguration">): string {
  return `${evalDirectoryName(evalCase)}\0${runConfiguration}`;
}

function formatGroupedTaskStatuses({
  evals,
  runConfigurations,
  statuses,
}: {
  evals: EvalCase[];
  runConfigurations: RunConfiguration[];
  statuses: Map<string, string>;
}): string {
  return [...evals]
    .sort(
      (left, right) =>
        left.id - right.id ||
        evalDirectoryName(left).localeCompare(evalDirectoryName(right)),
    )
    .map((evalCase) => {
      const evalName = evalDirectoryName(evalCase);
      const lines = [evalName];
      for (const runConfiguration of runConfigurations) {
        const prefix = runConfiguration === "with_skill" ? "   " : "";
        lines.push(
          `${prefix}${runConfiguration}: ${
            statuses.get(taskStatusKey({ evalCase, runConfiguration })) ??
            "not completed"
          }`,
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function isInsidePath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function validateWorkspacePath({
  skillPath,
  workspace,
}: {
  skillPath: string;
  workspace: string;
}): void {
  if (isInsidePath(skillPath, workspace)) {
    fail("--workspace must be outside the skill directory");
  }
}

function validateOldSkillSnapshotPath(oldSkillPath: string): void {
  const oldSkillFile = path.join(oldSkillPath, "SKILL.md");
  if (!fs.existsSync(oldSkillFile)) {
    fail(`${oldSkillPath}: old_skill snapshot must contain SKILL.md`);
  }
}

function validateOldSkillIsSeparate({
  oldSkillPath,
  skillPath,
}: {
  oldSkillPath: string;
  skillPath: string;
}): void {
  if (isInsidePath(skillPath, oldSkillPath)) {
    fail("--old-skill-path must be a separate previous skill snapshot");
  }
}

function copySkillSnapshot({
  sourcePath,
  targetPath,
}: {
  sourcePath: string;
  targetPath: string;
}): void {
  if (fs.existsSync(targetPath)) {
    fail(`${targetPath} already exists; old_skill snapshots are immutable`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function prepareOldSkillSnapshot({
  oldSkillPath,
  skillPath,
  workspace,
}: {
  oldSkillPath: string | null;
  skillPath: string;
  workspace: string;
}): OldSkillSnapshot {
  const workspaceSnapshotPath = path.join(workspace, "skill-snapshot");
  if (fs.existsSync(workspaceSnapshotPath)) {
    if (
      oldSkillPath &&
      path.resolve(oldSkillPath) !== path.resolve(workspaceSnapshotPath)
    ) {
      fail(
        `${workspaceSnapshotPath} already exists; remove it before supplying a different --old-skill-path`,
      );
    }
    validateOldSkillSnapshotPath(workspaceSnapshotPath);
    validateOldSkillIsSeparate({
      oldSkillPath: workspaceSnapshotPath,
      skillPath,
    });
    return {
      path: workspaceSnapshotPath,
      provenance: "existing_workspace_snapshot",
      source_path: workspaceSnapshotPath,
    };
  }

  if (!oldSkillPath) {
    fail(
      "--old-skill-path is required for old_skill unless <workspace>/skill-snapshot already exists",
    );
  }
  validateOldSkillSnapshotPath(oldSkillPath);
  validateOldSkillIsSeparate({ oldSkillPath, skillPath });
  copySkillSnapshot({
    sourcePath: oldSkillPath,
    targetPath: workspaceSnapshotPath,
  });

  return {
    path: workspaceSnapshotPath,
    provenance: "copied_from_supplied_snapshot",
    source_path: oldSkillPath,
  };
}

function verificationScriptPath(skillPath: string): string | null {
  for (const fileName of ["verify.mjs", "verify.js", "verify.cjs"]) {
    const candidate = path.join(skillPath, "evals", fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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

function copyRunSkill({
  sandboxRoot,
  sourcePath,
}: {
  sandboxRoot: string;
  sourcePath: string;
}): string {
  const sandboxSkillPath = path.join(sandboxRoot, "skill");
  if (fs.existsSync(sandboxSkillPath)) {
    fail(`${sandboxSkillPath} already exists; run sandboxes must be fresh`);
  }

  fs.cpSync(sourcePath, sandboxSkillPath, { recursive: true });
  return sandboxSkillPath;
}

function prepareWorkingDirectoryForRun({
  evalCase,
  runConfiguration,
  skillPath,
  oldSkillPath,
  sandboxRoot,
}: {
  evalCase: EvalCase;
  runConfiguration: RunConfiguration;
  skillPath: string;
  oldSkillPath: string | null;
  sandboxRoot: string;
}): string {
  if (runConfiguration === "with_skill") {
    return copyRunSkill({ sandboxRoot, sourcePath: skillPath });
  }
  if (runConfiguration === "old_skill") {
    if (!oldSkillPath) {
      fail("--old-skill-path is required when running old_skill");
    }
    return copyRunSkill({ sandboxRoot, sourcePath: oldSkillPath });
  }

  const inputDir = path.join(sandboxRoot, "input");
  fs.mkdirSync(inputDir, { recursive: true });
  copyInputFiles(skillPath, inputDir, evalCase);
  return inputDir;
}

function buildPrompt({
  evalCase,
  skillPath,
  outputDir,
}: {
  evalCase: EvalCase;
  skillPath: string | null;
  outputDir: string;
}): string {
  const inputFiles =
    evalCase.files.length === 0 ? "none" : evalCase.files.join(", ");
  const lines = ["Execute this task:"];

  if (skillPath) {
    lines.push(
      `- Skill path: ${skillPath}`,
      `- Read and follow the skill instructions in: ${path.join(skillPath, "SKILL.md")}`,
    );
  }

  lines.push(
    `- Task: ${evalCase.prompt}`,
    `- Input files: ${inputFiles}`,
    `- Save outputs to: ${outputDir}`,
    `- The final response will be saved to ${path.join(outputDir, "output.md")}; include the complete review and any code fix in the final response, not only links to files.`,
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
      // Non-JSON output is not part of agent usage accounting.
    }
  }
  return found;
}

function extractDurationMs(jsonl: string): number | null {
  let found: number | null = null;
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const value = JSON.parse(line);
      found = findDurationMsValue(value) ?? found;
    } catch {
      // Non-JSON output is not part of agent duration accounting.
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

function findDurationMsValue(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (Number.isFinite(record.duration_ms)) {
    return record.duration_ms as number;
  }

  for (const child of Object.values(record)) {
    const found = findDurationMsValue(child);
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

function providerForModel(model: string): AgentProvider {
  return model.toLowerCase().startsWith("claude") ? "claude" : "codex";
}

function invokeClaudeCli({
  addDirs,
  effort,
  model,
  workingDir,
  prompt,
}: AgentRunRequest): Promise<AgentRunResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const addDirArgs = addDirs.flatMap((directory) => ["--add-dir", directory]);
    const child = spawn(
      process.env.SKILL_EVAL_CLAUDE_BIN ?? "claude",
      [
        "--print",
        ...addDirArgs,
        "--model",
        model,
        "--effort",
        effort,
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
      const output = extractClaudeOutput(stdout);
      const measuredDurationMs = Date.now() - startedAt;
      resolve({
        duration_ms: extractDurationMs(stdout) ?? measuredDurationMs,
        exit_code: exitCode,
        output,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout,
        total_tokens: extractTotalTokens(stdout),
      });
    });
  });
}

function invokeCodexCli({
  addDirs,
  effort,
  model,
  workingDir,
  prompt,
}: AgentRunRequest): Promise<AgentRunResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const outputFile = path.join(
      os.tmpdir(),
      `skill-eval-codex-output-${process.pid}-${startedAt}-${Math.random()
        .toString(36)
        .slice(2)}.md`,
    );
    const addDirArgs = addDirs.flatMap((directory) => ["--add-dir", directory]);
    const child = spawn(
      process.env.SKILL_EVAL_CODEX_BIN ?? "codex",
      [
        "exec",
        "--json",
        "--model",
        model,
        "-c",
        `model_reasoning_effort=${JSON.stringify(effort)}`,
        "--cd",
        workingDir,
        ...addDirArgs,
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "--output-last-message",
        outputFile,
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
      const measuredDurationMs = Date.now() - startedAt;
      const output = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, "utf8")
        : extractClaudeOutput(stdout);
      fs.rmSync(outputFile, { force: true });
      resolve({
        duration_ms: extractDurationMs(stdout) ?? measuredDurationMs,
        exit_code: exitCode,
        output: output.endsWith("\n") || output === "" ? output : `${output}\n`,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout,
        total_tokens: extractTotalTokens(stdout),
      });
    });
  });
}

const agentAdapters: Record<AgentProvider, AgentAdapter> = {
  claude: {
    provider: "claude",
    invoke: invokeClaudeCli,
  },
  codex: {
    provider: "codex",
    invoke: invokeCodexCli,
  },
};

function adapterForModel(model: string): AgentAdapter {
  return agentAdapters[providerForModel(model)];
}

function invokeAgent(request: AgentRunRequest): Promise<AgentRunResult> {
  return adapterForModel(request.model).invoke(request);
}

function requireTotalTokens(result: AgentRunResult, label: string): number {
  if (result.total_tokens === null) {
    fail(
      `${label}: agent output did not include total token usage; cannot write timing.json`,
    );
  }
  return result.total_tokens;
}

async function runAgent({
  effort,
  model,
  workingDir,
  outputFile,
  outputDir,
  prompt,
}: {
  effort: string;
  model: string;
  workingDir: string;
  outputFile: string;
  outputDir: string;
  prompt: string;
}): Promise<AgentRunResult> {
  const result = await invokeAgent({
    addDirs: [outputDir],
    effort,
    model,
    workingDir,
    prompt,
  });
  writeText(outputFile, result.output);
  return result;
}

function summarizeAssertions(
  results: AssertionResult[],
): GradingJson["summary"] {
  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  const failed = total - passed;
  return {
    passed,
    failed,
    total,
    pass_rate: total === 0 ? null : passed / total,
  };
}

function emptyGrading(): GradingJson {
  return {
    assertion_results: [],
    summary: summarizeAssertions([]),
  };
}

function listFilesRecursive(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, entryPath));
      }
    }
  }

  visit(root);
  return files.sort();
}

function isReadableText(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return false;
  }

  const sample = buffer.subarray(0, 4096);
  let suspicious = 0;
  for (const byte of sample) {
    const isControl = byte < 9 || (byte > 13 && byte < 32);
    if (isControl) {
      suspicious += 1;
    }
  }
  return sample.length === 0 || suspicious / sample.length < 0.05;
}

function outputInventory(outputDir: string): string {
  const maxTextBytes = 20000;
  const entries = listFilesRecursive(outputDir);
  if (entries.length === 0) {
    return "No output files were produced.\n";
  }

  return entries
    .map((relativePath) => {
      const absolutePath = path.join(outputDir, relativePath);
      const contents = fs.readFileSync(absolutePath);
      const stats = fs.statSync(absolutePath);
      const header = `File: ${relativePath} (${stats.size} bytes)`;
      if (!isReadableText(contents)) {
        return `${header}\n[Binary or non-text file; inspect by path if needed.]`;
      }

      const text = contents.toString("utf8");
      const truncated =
        contents.length > maxTextBytes
          ? `${text.slice(0, maxTextBytes)}\n[Truncated after ${maxTextBytes} bytes.]`
          : text;
      return `${header}\n\`\`\`\n${truncated}\n\`\`\``;
    })
    .join("\n\n");
}

function buildGradingPrompt({
  assertions,
  evalCase,
  outputDir,
}: {
  assertions: string[];
  evalCase: EvalCase;
  outputDir: string;
}): string {
  const expectedOutputSection = evalCase.expected_output
    ? `\nExpected output:\n${evalCase.expected_output}\n`
    : "";

  return `Grade this skill eval run against its assertions.

Use only the files in the output directory and the output inventory below. Grade each assertion directly and require concrete evidence for every PASS or FAIL. If the output only gestures at an assertion without satisfying its substance, mark it failed.

Task prompt:
${evalCase.prompt}
${expectedOutputSection}

Output directory:
${outputDir}

Output inventory:
${outputInventory(outputDir)}

Assertions to grade, in order:
${assertions.map((assertion, index) => `${index + 1}. ${assertion}`).join("\n")}

Return only valid JSON with this exact shape and no markdown:
{
  "assertion_results": [
    {
      "text": "copy the assertion text exactly",
      "passed": true,
      "evidence": "quote or reference the concrete output evidence"
    }
  ],
  "summary": {
    "passed": 0,
    "failed": 0,
    "total": 0,
    "pass_rate": 0
  }
}
`;
}

function invokeNodeScript({
  args,
  cwd,
  scriptPath,
}: {
  args: string[];
  cwd: string;
  scriptPath: string;
}): Promise<{
  exit_code: number | null;
  stderr: string;
  stdout: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      stderrChunks.push(Buffer.from(`${error.message}\n`));
    });
    child.on("close", (exitCode) => {
      resolve({
        exit_code: exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

function parseJsonObjectFromText(text: string, label: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      fail(`${label}: expected grader to return a JSON object`);
    }

    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch (error) {
      fail(`${label}: invalid grader JSON: ${(error as Error).message}`);
    }
  }
}

function normalizeGradingJson(
  value: unknown,
  assertions: string[],
  label: string,
): GradingJson {
  assertRecord(value, label);
  const rawResults = value.assertion_results;
  if (!Array.isArray(rawResults)) {
    fail(`${label}.assertion_results must be an array`);
  }
  if (rawResults.length !== assertions.length) {
    fail(
      `${label}.assertion_results must contain exactly ${assertions.length} results`,
    );
  }

  const assertionResults = rawResults.map((rawResult, index) => {
    assertRecord(rawResult, `${label}.assertion_results[${index}]`);
    assertAllowedKeys(rawResult, `${label}.assertion_results[${index}]`, [
      "text",
      "passed",
      "evidence",
    ]);

    const text = rawResult.text;
    const passed = rawResult.passed;
    const evidence = rawResult.evidence;
    if (typeof text !== "string" || text !== assertions[index]) {
      fail(
        `${label}.assertion_results[${index}].text must copy the assertion exactly`,
      );
    }
    if (typeof passed !== "boolean") {
      fail(`${label}.assertion_results[${index}].passed must be a boolean`);
    }
    assertString(evidence, `${label}.assertion_results[${index}].evidence`);

    return {
      text,
      passed,
      evidence,
    };
  });

  return {
    assertion_results: assertionResults,
    summary: summarizeAssertions(assertionResults),
  };
}

function normalizeVerificationJson(
  value: unknown,
  assertions: string[],
  label: string,
): AssertionResult[] {
  assertRecord(value, label);
  const rawResults = value.assertion_results;
  if (!Array.isArray(rawResults)) {
    fail(`${label}.assertion_results must be an array`);
  }

  const allowedAssertions = new Set(assertions);
  const seenAssertions = new Set<string>();
  return rawResults.map((rawResult, index) => {
    assertRecord(rawResult, `${label}.assertion_results[${index}]`);
    assertAllowedKeys(rawResult, `${label}.assertion_results[${index}]`, [
      "text",
      "passed",
      "evidence",
    ]);

    const text = rawResult.text;
    const passed = rawResult.passed;
    const evidence = rawResult.evidence;
    assertString(text, `${label}.assertion_results[${index}].text`);
    if (!allowedAssertions.has(text)) {
      fail(
        `${label}.assertion_results[${index}].text does not match an eval assertion`,
      );
    }
    if (seenAssertions.has(text)) {
      fail(`${label}.assertion_results[${index}].text duplicates an assertion`);
    }
    seenAssertions.add(text);
    if (typeof passed !== "boolean") {
      fail(`${label}.assertion_results[${index}].passed must be a boolean`);
    }
    assertString(evidence, `${label}.assertion_results[${index}].evidence`);

    return {
      text,
      passed,
      evidence,
    };
  });
}

async function gradeAssertionsWithLlm({
  assertions,
  effort,
  evalCase,
  model,
  outputDir,
  label,
}: {
  assertions: string[];
  effort: string;
  evalCase: EvalCase;
  model: string;
  outputDir: string;
  label: string;
}): Promise<AssertionResult[]> {
  if (assertions.length === 0) {
    return [];
  }

  const result = await invokeAgent({
    addDirs: [outputDir],
    effort,
    model,
    workingDir: outputDir,
    prompt: buildGradingPrompt({ assertions, evalCase, outputDir }),
  });
  if (result.exit_code !== 0) {
    const stderr = result.stderr.trim();
    fail(`${label}: grader failed${stderr ? `: ${stderr}` : ""}`);
  }

  const parsed = parseJsonObjectFromText(result.output, `${label} grading`);
  return normalizeGradingJson(parsed, assertions, `${label} grading`)
    .assertion_results;
}

async function runVerificationScript({
  evalCase,
  evalDir,
  outputDir,
  runConfiguration,
  skillPath,
}: {
  evalCase: EvalCase;
  evalDir: string;
  outputDir: string;
  runConfiguration: RunConfiguration;
  skillPath: string;
}): Promise<AssertionResult[]> {
  const scriptPath = verificationScriptPath(skillPath);
  if (!scriptPath) {
    return [];
  }

  const evalsJsonPath = path.join(skillPath, evalsFileName);
  const label = `${path.basename(evalDir)} ${runConfiguration} verification`;
  const result = await invokeNodeScript({
    args: [
      "--evals-json",
      evalsJsonPath,
      "--eval-id",
      String(evalCase.id),
      "--output-dir",
      outputDir,
      "--run-configuration",
      runConfiguration,
      "--skill-path",
      skillPath,
    ],
    cwd: skillPath,
    scriptPath,
  });
  if (result.exit_code !== 0) {
    const stderr = result.stderr.trim();
    fail(`${label}: verification script failed${stderr ? `: ${stderr}` : ""}`);
  }
  if (result.stdout.trim() === "") {
    return [];
  }

  const parsed = parseJsonObjectFromText(result.stdout, label);
  return normalizeVerificationJson(parsed, evalCase.assertions, label);
}

async function gradeRun({
  effort,
  evalCase,
  evalDir,
  model,
  runConfiguration,
  skillPath,
}: {
  effort: string;
  evalCase: EvalCase;
  evalDir: string;
  model: string;
  runConfiguration: RunConfiguration;
  skillPath: string;
}): Promise<GradeOutcome> {
  const runDir = path.join(evalDir, runConfiguration);
  const gradingPath = path.join(runDir, "grading.json");
  if (evalCase.assertions.length === 0) {
    writeJson(gradingPath, emptyGrading());
    return { status: "graded 0/0" };
  }

  const outputDir = path.join(runDir, "outputs");
  const deterministicResults = await runVerificationScript({
    evalCase,
    evalDir,
    outputDir,
    runConfiguration,
    skillPath,
  });
  const deterministicByText = new Map(
    deterministicResults.map((result) => [result.text, result]),
  );
  const remainingAssertions = evalCase.assertions.filter(
    (assertion) => !deterministicByText.has(assertion),
  );
  const llmResults = await gradeAssertionsWithLlm({
    assertions: remainingAssertions,
    effort,
    evalCase,
    model,
    outputDir,
    label: `${path.basename(evalDir)} ${runConfiguration}`,
  });
  const llmByText = new Map(llmResults.map((result) => [result.text, result]));

  const assertionResults = evalCase.assertions.map((assertion) => {
    const result =
      deterministicByText.get(assertion) ?? llmByText.get(assertion);
    if (!result) {
      fail(
        `${path.basename(evalDir)} ${runConfiguration}: missing grade for assertion "${assertion}"`,
      );
    }
    return result;
  });
  const grading: GradingJson = {
    assertion_results: assertionResults,
    summary: summarizeAssertions(assertionResults),
  };
  writeJson(gradingPath, grading);
  return {
    status: `graded ${grading.summary.passed}/${grading.summary.total}`,
  };
}

function readTiming(runDir: string): {
  duration_ms: number;
  total_tokens: number;
} {
  const timingPath = path.join(runDir, "timing.json");
  const timing = readJsonFile<Record<string, unknown>>(timingPath);
  assertAllowedKeys(timing, timingPath, ["duration_ms", "total_tokens"]);
  const durationMs = timing.duration_ms;
  const totalTokens = timing.total_tokens;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    fail(`${timingPath}.duration_ms must be a finite number`);
  }
  if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens)) {
    fail(`${timingPath}.total_tokens must be a finite number`);
  }

  return {
    duration_ms: durationMs,
    total_tokens: totalTokens,
  };
}

function readGrading(runDir: string): GradingJson {
  const gradingPath = path.join(runDir, "grading.json");
  const grading = readJsonFile<Record<string, unknown>>(gradingPath);
  assertRecord(grading, gradingPath);

  const rawResults = grading.assertion_results;
  if (!Array.isArray(rawResults)) {
    fail(`${gradingPath}.assertion_results must be an array`);
  }

  const assertionResults = rawResults.map((rawResult, index) => {
    assertRecord(rawResult, `${gradingPath}.assertion_results[${index}]`);
    const text = rawResult.text;
    const passed = rawResult.passed;
    const evidence = rawResult.evidence;
    assertString(text, `${gradingPath}.assertion_results[${index}].text`);
    if (typeof passed !== "boolean") {
      fail(`${gradingPath}.assertion_results[${index}].passed must be boolean`);
    }
    assertString(
      evidence,
      `${gradingPath}.assertion_results[${index}].evidence`,
    );
    return { text, passed, evidence };
  });

  return {
    assertion_results: assertionResults,
    summary: summarizeAssertions(assertionResults),
  };
}

function readRunStats(runDir: string): RunStats {
  const timing = readTiming(runDir);
  const grading = readGrading(runDir);

  return {
    failed: grading.summary.failed,
    pass_rate: grading.summary.pass_rate,
    passed: grading.summary.passed,
    time_seconds: timing.duration_ms / 1000,
    tokens: timing.total_tokens,
    total: grading.summary.total,
  };
}

function metric(values: Array<number | null>): BenchmarkMetric {
  const numericValues = values.filter(
    (value): value is number => value !== null,
  );
  if (numericValues.length === 0) {
    return { mean: null, stddev: null };
  }

  const mean =
    numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  const variance =
    numericValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    numericValues.length;
  return {
    mean,
    stddev: Math.sqrt(variance),
  };
}

function configurationSummary(
  stats: RunStats[],
): BenchmarkConfigurationSummary {
  return {
    pass_rate: metric(stats.map((stat) => stat.pass_rate)),
    time_seconds: metric(stats.map((stat) => stat.time_seconds)),
    tokens: metric(stats.map((stat) => stat.tokens)),
  };
}

function metricDelta(
  withSkill: BenchmarkMetric,
  baseline: BenchmarkMetric,
): number | null {
  if (withSkill.mean === null || baseline.mean === null) {
    return null;
  }
  return withSkill.mean - baseline.mean;
}

function writeBenchmark({
  evals,
  iterationDir,
  runConfigurations,
}: {
  evals: EvalCase[];
  iterationDir: string;
  runConfigurations: RunConfiguration[];
}): void {
  const runSummary: Record<string, unknown> = {};
  const summaries: Record<string, BenchmarkConfigurationSummary> = {};
  for (const runConfiguration of runConfigurations) {
    const stats = evals.map((evalCase) =>
      readRunStats(
        path.join(iterationDir, evalDirectoryName(evalCase), runConfiguration),
      ),
    );
    const summary = configurationSummary(stats);
    summaries[runConfiguration] = summary;
    runSummary[runConfiguration] = summary;
  }

  const baseline = runConfigurations.find(
    (runConfiguration) => runConfiguration !== "with_skill",
  );
  if (baseline) {
    runSummary.delta = {
      pass_rate: metricDelta(
        summaries.with_skill.pass_rate,
        summaries[baseline].pass_rate,
      ),
      time_seconds: metricDelta(
        summaries.with_skill.time_seconds,
        summaries[baseline].time_seconds,
      ),
      tokens: metricDelta(
        summaries.with_skill.tokens,
        summaries[baseline].tokens,
      ),
    };
  }

  writeJson(path.join(iterationDir, "benchmark.json"), {
    run_summary: runSummary,
  });
}

function writeFeedbackJson({
  evals,
  iterationDir,
}: {
  evals: EvalCase[];
  iterationDir: string;
}): void {
  const feedback = Object.fromEntries(
    evals.map((evalCase) => [evalDirectoryName(evalCase), ""]),
  );
  writeJson(path.join(iterationDir, "feedback.json"), feedback);
}

async function runOneConfiguration({
  effort,
  evalCase,
  evalDir,
  model,
  runConfiguration,
  skillPath,
  oldSkillPath,
}: {
  effort: string;
  evalCase: EvalCase;
  evalDir: string;
  model: string;
  runConfiguration: RunConfiguration;
  skillPath: string;
  oldSkillPath: string | null;
}): Promise<RunOutcome> {
  const runDir = path.join(evalDir, runConfiguration);
  const outputDir = path.join(runDir, "outputs");
  fs.mkdirSync(outputDir, { recursive: true });

  const sandboxRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      `skill-eval-${path.basename(evalDir)}-${runConfiguration}-`,
    ),
  );
  try {
    const workingDir = prepareWorkingDirectoryForRun({
      evalCase,
      runConfiguration,
      skillPath,
      oldSkillPath,
      sandboxRoot,
    });
    const outputFile = path.join(outputDir, "output.md");
    const promptSkillPath =
      runConfiguration === "without_skill" ? null : workingDir;
    const prompt = buildPrompt({
      evalCase,
      skillPath: promptSkillPath,
      outputDir,
    });
    const result = await runAgent({
      effort,
      model,
      workingDir,
      outputFile,
      outputDir,
      prompt,
    });
    const totalTokens = requireTotalTokens(
      result,
      `${path.basename(evalDir)} ${runConfiguration}`,
    );

    writeJson(path.join(runDir, "timing.json"), {
      total_tokens: totalTokens,
      duration_ms: result.duration_ms,
    });

    const exitCode = result.exit_code ?? 1;
    return {
      exitCode,
    };
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

async function runAllConfigurations({
  effort,
  evals,
  iterationDir,
  model,
  oldSkillPath,
  runConfigurations,
  skillPath,
}: {
  effort: string;
  evals: EvalCase[];
  iterationDir: string;
  model: string;
  oldSkillPath: string | null;
  runConfigurations: RunConfiguration[];
  skillPath: string;
}): Promise<number> {
  const runTasks: RunTask[] = evals.flatMap((evalCase) => {
    const evalDir = path.join(iterationDir, evalDirectoryName(evalCase));
    return runConfigurations.map((runConfiguration) => ({
      evalCase,
      evalDir,
      runConfiguration,
    }));
  });

  const runResults = await Promise.allSettled(
    runTasks.map((task) =>
      runOneConfiguration({
        ...task,
        effort,
        model,
        skillPath,
        oldSkillPath,
      }),
    ),
  );

  const failures: string[] = [];
  const runStatuses = new Map<string, string>();
  let exitCode = 0;
  let hasFailedRun = false;
  for (let index = 0; index < runTasks.length; index += 1) {
    const result = runResults[index];
    const task = runTasks[index];
    const label = runTaskLabel(task);
    if (result.status === "rejected") {
      const message = `${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
      failures.push(message);
      runStatuses.set(taskStatusKey(task), message);
      hasFailedRun = true;
      continue;
    }

    runStatuses.set(taskStatusKey(task), `exit ${result.value.exitCode}`);
    if (result.value.exitCode !== 0 && exitCode === 0) {
      exitCode = result.value.exitCode;
    }
    if (result.value.exitCode !== 0) {
      hasFailedRun = true;
    }
  }

  if (hasFailedRun) {
    console.log(
      formatGroupedTaskStatuses({
        evals,
        runConfigurations,
        statuses: runStatuses,
      }),
    );
  }

  if (failures.length > 0) {
    fail(failures.join("\n"));
  }

  return exitCode;
}

async function gradeAllRuns({
  effort,
  evals,
  iterationDir,
  model,
  runConfigurations,
  skillPath,
}: {
  effort: string;
  evals: EvalCase[];
  iterationDir: string;
  model: string;
  runConfigurations: RunConfiguration[];
  skillPath: string;
}): Promise<boolean> {
  const gradeTasks: RunTask[] = evals.flatMap((evalCase) => {
    const evalDir = path.join(iterationDir, evalDirectoryName(evalCase));
    return runConfigurations.map((runConfiguration) => ({
      evalCase,
      evalDir,
      runConfiguration,
    }));
  });

  const gradeResults = await Promise.allSettled(
    gradeTasks.map((task) =>
      gradeRun({
        ...task,
        effort,
        model,
        skillPath,
      }),
    ),
  );

  const gradeStatuses = new Map<string, string>();
  const failures: string[] = [];
  for (let index = 0; index < gradeTasks.length; index += 1) {
    const task = gradeTasks[index];
    const result = gradeResults[index];
    if (result.status === "fulfilled") {
      gradeStatuses.set(taskStatusKey(task), result.value.status);
      continue;
    }

    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    gradeStatuses.set(taskStatusKey(task), message);
    failures.push(message);
  }

  console.log(
    formatGroupedTaskStatuses({
      evals,
      runConfigurations,
      statuses: gradeStatuses,
    }),
  );

  return failures.length === 0;
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
  validateWorkspacePath({ skillPath, workspace });
  const iteration = args.iteration ?? nextIteration(workspace);
  const iterationDir = path.join(workspace, `iteration-${iteration}`);
  if (fs.existsSync(iterationDir)) {
    fail(`${iterationDir} already exists; use the next iteration directory`);
  }
  const oldSkillSnapshot =
    args.baseline === "old_skill"
      ? prepareOldSkillSnapshot({
          oldSkillPath: args.oldSkillPath,
          skillPath,
          workspace,
        })
      : null;

  fs.mkdirSync(iterationDir, { recursive: true });
  const runConfigurations: RunConfiguration[] = ["with_skill", args.baseline];

  for (const evalCase of evals) {
    const evalDir = path.join(iterationDir, evalDirectoryName(evalCase));
    fs.mkdirSync(evalDir, { recursive: true });
  }

  const exitCode = await runAllConfigurations({
    effort: args.effort,
    evals,
    iterationDir,
    model: args.model,
    oldSkillPath: oldSkillSnapshot?.path ?? null,
    runConfigurations,
    skillPath,
  });
  if (exitCode !== 0) {
    fail(
      `One or more eval runs exited non-zero (${exitCode}); not grading or benchmarking failed outputs`,
    );
  }

  const gradingSucceeded = await gradeAllRuns({
    effort: args.effort,
    evals,
    iterationDir,
    model: args.model,
    runConfigurations,
    skillPath,
  });
  if (!gradingSucceeded) {
    process.exitCode = 1;
    return;
  }

  writeBenchmark({ evals, iterationDir, runConfigurations });
  writeFeedbackJson({ evals, iterationDir });
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
