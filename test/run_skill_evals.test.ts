import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  makeSkillFixture,
  repoRoot,
  runNode,
  runScript,
} from "../test_support/skill_eval_fixtures.ts";

function writeFakeClaude(
  fixtureRoot: string,
  body: string = `
const prompt = process.argv.at(-1) || "";
function requireArg(flag, value) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || process.argv[index + 1] !== value) {
    process.stderr.write("missing " + flag + " " + value + "\\n");
    process.exit(2);
  }
}
if (!process.argv.includes("--print")) {
  process.stderr.write("missing --print\\n");
  process.exit(2);
}
requireArg("--model", "claude-sonnet-4-6");
requireArg("--effort", "medium");
requireArg("--permission-mode", "bypassPermissions");
requireArg("--output-format", "json");
if (prompt.includes("Grade this skill eval run")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      assertion_results: [
        {
          text: "The output reports the expected issue.",
          passed: true,
          evidence: "outputs/output.md contains review output"
        }
      ],
      summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 }
    }),
    usage: { input_tokens: 4, output_tokens: 6 }
  }) + "\\n");
  process.exit(0);
}
if (prompt.includes("Blindly compare skill eval outputs")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      preferred_output: "A",
      scores: { A: 4, B: 3 },
      rationale: "Output A is more complete.",
      actionable_feedback: "Make the weaker output more specific."
    }),
    usage: { input_tokens: 2, output_tokens: 3 }
  }) + "\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({
  result: "review output\\n",
  usage: {
    input_tokens: 10,
    output_tokens: 5
  }
}) + "\\n");
`,
): string {
  const fakeClaude = path.join(fixtureRoot, "fake-claude.cjs");
  fs.writeFileSync(fakeClaude, `#!/usr/bin/env node\n${body}`);
  fs.chmodSync(fakeClaude, 0o755);
  return fakeClaude;
}

test("run_skill_evals writes the documented workspace with baseline runs", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CLAUDE_BIN: writeFakeClaude(fixture.root) } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /eval-sample-1 with_skill: exit 0/);
  assert.match(result.stdout, /eval-sample-1 without_skill: exit 0/);
  assert.match(result.stdout, /eval-sample-1 with_skill: graded 1\/1/);
  assert.match(result.stdout, /eval-sample-1 without_skill: graded 1\/1/);

  const iterationDir = path.join(fixture.workspace, "iteration-1");
  const evalDir = path.join(iterationDir, "eval-sample-1");
  assert.equal(fs.existsSync(path.join(iterationDir, "eval-1")), false);
  assert.ok(
    fs.existsSync(path.join(evalDir, "with_skill", "outputs", "output.md")),
  );
  assert.ok(fs.existsSync(path.join(evalDir, "with_skill", "timing.json")));
  assert.ok(
    fs.existsSync(path.join(evalDir, "without_skill", "outputs", "output.md")),
  );
  assert.ok(fs.existsSync(path.join(evalDir, "without_skill", "timing.json")));
  assert.ok(fs.existsSync(path.join(evalDir, "with_skill", "grading.json")));
  assert.ok(fs.existsSync(path.join(evalDir, "without_skill", "grading.json")));
  assert.ok(fs.existsSync(path.join(iterationDir, "benchmark.json")));
  assert.ok(fs.existsSync(path.join(iterationDir, "feedback.json")));
  assert.deepEqual(fs.readdirSync(iterationDir).sort(), [
    "benchmark.json",
    "eval-sample-1",
    "feedback.json",
  ]);
  assert.deepEqual(fs.readdirSync(evalDir).sort(), [
    "with_skill",
    "without_skill",
  ]);
  assert.deepEqual(fs.readdirSync(path.join(evalDir, "with_skill")).sort(), [
    "grading.json",
    "outputs",
    "timing.json",
  ]);
  assert.deepEqual(fs.readdirSync(path.join(evalDir, "without_skill")).sort(), [
    "grading.json",
    "outputs",
    "timing.json",
  ]);

  const timing = JSON.parse(
    fs.readFileSync(path.join(evalDir, "with_skill", "timing.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(timing).sort(), ["duration_ms", "total_tokens"]);
  assert.equal(timing.total_tokens, 15);
  assert.equal(
    fs.readFileSync(
      path.join(evalDir, "with_skill", "outputs", "output.md"),
      "utf8",
    ),
    "review output\n",
  );
  const grading = JSON.parse(
    fs.readFileSync(path.join(evalDir, "with_skill", "grading.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(grading.assertion_results[0]).sort(), [
    "evidence",
    "passed",
    "text",
  ]);
  assert.equal(grading.summary.pass_rate, 1);
  const benchmark = JSON.parse(
    fs.readFileSync(path.join(iterationDir, "benchmark.json"), "utf8"),
  );
  assert.equal(benchmark.run_summary.with_skill.pass_rate.mean, 1);
  assert.equal(benchmark.run_summary.without_skill.pass_rate.mean, 1);
  assert.equal(benchmark.run_summary.delta.pass_rate, 0);
  assert.deepEqual(Object.keys(benchmark).sort(), ["run_summary"]);
  const feedback = JSON.parse(
    fs.readFileSync(path.join(iterationDir, "feedback.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(feedback), [path.basename(evalDir)]);
});

test("run_skill_evals derives semantic names for file-only prompts", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Do not read other files, review evals/files/eval-1.ts.",
          expected_output:
            'Reviews the formatter as a closed-union exhaustiveness issue and recommends explicitly handling "json" plus a never-based exhaustive fallback.',
          files: ["evals/files/eval-1.ts"],
        },
      ],
    },
    files: {
      "evals/files/eval-1.ts": "type ExportFormat = 'csv' | 'json';\n",
    },
  });

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CLAUDE_BIN: writeFakeClaude(fixture.root) } },
  );

  assert.equal(result.status, 0, result.stderr);
  const iterationDir = path.join(fixture.workspace, "iteration-1");
  const evalDir = path.join(iterationDir, "eval-closed-union-exhaustiveness-1");
  assert.ok(fs.existsSync(evalDir));
  assert.equal(fs.existsSync(path.join(iterationDir, "eval-eval-ts-1")), false);
  assert.deepEqual(fs.readdirSync(evalDir).sort(), [
    "with_skill",
    "without_skill",
  ]);
});

test("run_skill_evals accepts evals without optional files or assertions", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review the skill instructions.",
          expected_output: "Reports the expected issue.",
        },
      ],
    },
  });

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CLAUDE_BIN: writeFakeClaude(fixture.root) } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /eval-skill-instructions-1 with_skill/);
  assert.match(result.stdout, /eval-skill-instructions-1 without_skill/);
  const grading = JSON.parse(
    fs.readFileSync(
      path.join(
        fixture.workspace,
        "iteration-1",
        "eval-skill-instructions-1",
        "with_skill",
        "grading.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(grading, {
    assertion_results: [],
    summary: { passed: 0, failed: 0, total: 0, pass_rate: null },
  });
  assert.ok(
    fs.existsSync(
      path.join(
        fixture.workspace,
        "iteration-1",
        "eval-skill-instructions-1",
        "without_skill",
        "outputs",
        "output.md",
      ),
    ),
  );
});

test("run_skill_evals isolates without_skill in a copied input directory", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
      "references/skill-only.md": "Skill-specific guidance.\n",
    },
  });

  const fakeClaude = writeFakeClaude(
    fixture.root,
    `
const fs = require("node:fs");
const prompt = process.argv.at(-1) || "";
if (prompt.includes("Grade this skill eval run")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      assertion_results: [
        {
          text: "The output reports the expected issue.",
          passed: true,
          evidence: "outputs/output.md records cwd and copied input visibility"
        }
      ],
      summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 }
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
if (prompt.includes("Blindly compare skill eval outputs")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      preferred_output: "tie",
      scores: { A: 3, B: 3 },
      rationale: "Both outputs are equivalent.",
      actionable_feedback: ""
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({
  result: [
    "cwd=" + process.cwd(),
    "input=" + fs.existsSync("evals/files/sample.ts"),
    "skill=" + fs.existsSync("SKILL.md"),
    "reference=" + fs.existsSync("references/skill-only.md")
  ].join("\\n") + "\\n",
  usage: { input_tokens: 1, output_tokens: 2 }
}) + "\\n");
`,
  );

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CLAUDE_BIN: fakeClaude } },
  );

  assert.equal(result.status, 0, result.stderr);

  const runDir = path.join(
    fixture.workspace,
    "iteration-1",
    "eval-sample-1",
    "without_skill",
  );
  assert.equal(fs.existsSync(path.join(runDir, "input")), false);

  const output = fs.readFileSync(
    path.join(runDir, "outputs", "output.md"),
    "utf8",
  );
  const outputLines = Object.fromEntries(
    output
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split("=")),
  );
  assert.notEqual(outputLines.cwd, fs.realpathSync(runDir));
  assert.match(output, /input=true/);
  assert.match(output, /skill=false/);
  assert.match(output, /reference=false/);
});

test("run_skill_evals isolates with_skill in a per-run skill copy", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });

  const fakeClaude = writeFakeClaude(
    fixture.root,
    `
const fs = require("node:fs");
const prompt = process.argv.at(-1) || "";
if (prompt.includes("Grade this skill eval run")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      assertion_results: [
        {
          text: "The output reports the expected issue.",
          passed: true,
          evidence: "outputs/output.md records the sandbox cwd"
        }
      ],
      summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 }
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
if (prompt.includes("Blindly compare skill eval outputs")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      preferred_output: "tie",
      scores: { A: 3, B: 3 },
      rationale: "Both outputs are equivalent.",
      actionable_feedback: ""
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
if (fs.existsSync("SKILL.md")) {
  fs.appendFileSync("SKILL.md", "\\nSANDBOX_MUTATION\\n");
}
process.stdout.write(JSON.stringify({
  result: "cwd=" + process.cwd() + "\\nskill=" + fs.existsSync("SKILL.md") + "\\n",
  usage: { input_tokens: 1, output_tokens: 1 }
}) + "\\n");
`,
  );

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CLAUDE_BIN: fakeClaude } },
  );

  assert.equal(result.status, 0, result.stderr);
  const evalDir = path.join(fixture.workspace, "iteration-1", "eval-sample-1");
  assert.equal(fs.existsSync(path.join(evalDir, "with_skill", "skill")), false);
  assert.doesNotMatch(
    fs.readFileSync(path.join(fixture.skillPath, "SKILL.md"), "utf8"),
    /SANDBOX_MUTATION/,
  );
  const output = fs.readFileSync(
    path.join(evalDir, "with_skill", "outputs", "output.md"),
    "utf8",
  );
  assert.match(output, /skill=true/);
  const cwd = Object.fromEntries(
    output
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split("=")),
  ).cwd;
  assert.notEqual(cwd, fs.realpathSync(fixture.skillPath));
});

test("run_skill_evals finishes the run phase before grading multi-eval runs", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/alpha.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/alpha.ts"],
          assertions: ["The output reports the expected issue."],
        },
        {
          id: 2,
          prompt: "Review evals/files/beta.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/beta.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
    files: {
      "evals/files/alpha.ts": "const alpha = 1;\n",
      "evals/files/beta.ts": "const beta = 2;\n",
    },
  });
  const orderLog = path.join(fixture.root, "order.log");
  const fakeClaude = writeFakeClaude(
    fixture.root,
    `
const fs = require("node:fs");
const prompt = process.argv.at(-1) || "";
function record(kind) {
  const match = prompt.match(/iteration-1\\/([^/\\n]+)\\/([^/\\n]+)\\/outputs/);
  fs.appendFileSync(process.env.ORDER_LOG, kind + ":" + (match ? match[1] + ":" + match[2] : "unknown") + "\\n");
}
if (prompt.includes("Grade this skill eval run")) {
  record("grade");
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      assertion_results: [
        {
          text: "The output reports the expected issue.",
          passed: true,
          evidence: "outputs/output.md contains review output"
        }
      ],
      summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 }
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
if (prompt.includes("Blindly compare skill eval outputs")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      preferred_output: "tie",
      scores: { A: 3, B: 3 },
      rationale: "Both outputs are equivalent.",
      actionable_feedback: ""
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
record("run");
process.stdout.write(JSON.stringify({
  result: "review output\\n",
  usage: { input_tokens: 1, output_tokens: 1 }
}) + "\\n");
`,
  );

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    {
      env: {
        ORDER_LOG: orderLog,
        SKILL_EVAL_CLAUDE_BIN: fakeClaude,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const lines = fs.readFileSync(orderLog, "utf8").trim().split(/\r?\n/);
  const runIndexes = lines.flatMap((line, index) =>
    line.startsWith("run:") ? [index] : [],
  );
  const gradeIndexes = lines.flatMap((line, index) =>
    line.startsWith("grade:") ? [index] : [],
  );
  assert.equal(runIndexes.length, 4);
  assert.equal(gradeIndexes.length, 4);
  assert.ok(
    Math.max(...runIndexes) < Math.min(...gradeIndexes),
    lines.join("\n"),
  );
});

test("run_skill_evals aggregates multi-eval benchmark means, stddevs, and deltas", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review alpha.",
          expected_output: "Reports the expected alpha issue.",
          assertions: ["The output reports the expected issue."],
        },
        {
          id: 2,
          prompt: "Review beta.",
          expected_output: "Reports the expected beta issue.",
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
  });
  const fakeClaude = writeFakeClaude(
    fixture.root,
    `
const prompt = process.argv.at(-1) || "";
function currentRun() {
  const match = prompt.match(/iteration-1\\/([^/\\n]+)\\/([^/\\n]+)\\/outputs/);
  return {
    evalName: match ? match[1] : "unknown",
    configuration: match ? match[2] : "unknown"
  };
}
if (prompt.includes("Grade this skill eval run")) {
  const { evalName, configuration } = currentRun();
  const passed = evalName === "eval-alpha-1" && configuration === "with_skill";
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      assertion_results: [
        {
          text: "The output reports the expected issue.",
          passed,
          evidence: "outputs/output.md identifies " + evalName + " " + configuration
        }
      ],
      summary: { passed: passed ? 1 : 0, failed: passed ? 0 : 1, total: 1, pass_rate: passed ? 1 : 0 }
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
if (prompt.includes("Blindly compare skill eval outputs")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      preferred_output: "tie",
      scores: { A: 3, B: 3 },
      rationale: "Both outputs are equivalent.",
      actionable_feedback: ""
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
const { evalName, configuration } = currentRun();
const values = {
  "eval-alpha-1:with_skill": { tokens: 100, duration_ms: 1000 },
  "eval-alpha-1:without_skill": { tokens: 40, duration_ms: 500 },
  "eval-beta-2:with_skill": { tokens: 300, duration_ms: 3000 },
  "eval-beta-2:without_skill": { tokens: 80, duration_ms: 1500 }
}[evalName + ":" + configuration];
process.stdout.write(JSON.stringify({
  result: "eval=" + evalName + "\\nconfiguration=" + configuration + "\\n",
  usage: { total_tokens: values.tokens },
  duration_ms: values.duration_ms
}) + "\\n");
`,
  );

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CLAUDE_BIN: fakeClaude } },
  );

  assert.equal(result.status, 0, result.stderr);
  const iterationDir = path.join(fixture.workspace, "iteration-1");
  const benchmark = JSON.parse(
    fs.readFileSync(path.join(iterationDir, "benchmark.json"), "utf8"),
  );
  assert.deepEqual(benchmark.run_summary.with_skill.pass_rate, {
    mean: 0.5,
    stddev: 0.5,
  });
  assert.deepEqual(benchmark.run_summary.without_skill.pass_rate, {
    mean: 0,
    stddev: 0,
  });
  assert.deepEqual(benchmark.run_summary.with_skill.time_seconds, {
    mean: 2,
    stddev: 1,
  });
  assert.deepEqual(benchmark.run_summary.without_skill.time_seconds, {
    mean: 1,
    stddev: 0.5,
  });
  assert.deepEqual(benchmark.run_summary.with_skill.tokens, {
    mean: 200,
    stddev: 100,
  });
  assert.deepEqual(benchmark.run_summary.without_skill.tokens, {
    mean: 60,
    stddev: 20,
  });
  assert.deepEqual(benchmark.run_summary.delta, {
    pass_rate: 0.5,
    time_seconds: 1,
    tokens: 140,
  });
  assert.deepEqual(Object.keys(benchmark).sort(), ["run_summary"]);
});

test("run_skill_evals uses an immutable workspace snapshot for old_skill baseline", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });
  const oldSkillPath = path.join(fixture.root, "skill-snapshot");
  fs.cpSync(fixture.skillPath, oldSkillPath, { recursive: true });
  fs.appendFileSync(path.join(oldSkillPath, "SKILL.md"), "\nSNAPSHOT_ONLY\n");
  fs.appendFileSync(
    path.join(fixture.skillPath, "SKILL.md"),
    "\nCURRENT_ONLY\n",
  );
  const fakeClaude = writeFakeClaude(
    fixture.root,
    `
const fs = require("node:fs");
const prompt = process.argv.at(-1) || "";
if (prompt.includes("Grade this skill eval run")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      assertion_results: [
        {
          text: "The output reports the expected issue.",
          passed: true,
          evidence: "outputs/output.md records the skill snapshot marker"
        }
      ],
      summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 }
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
if (prompt.includes("Blindly compare skill eval outputs")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      preferred_output: "tie",
      scores: { A: 3, B: 3 },
      rationale: "Both outputs are equivalent.",
      actionable_feedback: ""
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
const skill = fs.readFileSync("SKILL.md", "utf8");
process.stdout.write(JSON.stringify({
  result: [
    "cwd=" + process.cwd(),
    "snapshot=" + skill.includes("SNAPSHOT_ONLY"),
    "current=" + skill.includes("CURRENT_ONLY")
  ].join("\\n") + "\\n",
  usage: { input_tokens: 1, output_tokens: 1 }
}) + "\\n");
`,
  );

  const result = runNode(
    runScript,
    [
      fixture.skillPath,
      "--workspace",
      fixture.workspace,
      "--iteration",
      "1",
      "--baseline",
      "old_skill",
      "--old-skill-path",
      oldSkillPath,
    ],
    { env: { SKILL_EVAL_CLAUDE_BIN: fakeClaude } },
  );

  assert.equal(result.status, 0, result.stderr);
  const workspaceSnapshot = path.join(fixture.workspace, "skill-snapshot");
  assert.ok(fs.existsSync(workspaceSnapshot));
  assert.match(
    fs.readFileSync(path.join(workspaceSnapshot, "SKILL.md"), "utf8"),
    /SNAPSHOT_ONLY/,
  );
  const evalDir = path.join(fixture.workspace, "iteration-1", "eval-sample-1");
  assert.ok(fs.existsSync(path.join(evalDir, "with_skill", "timing.json")));
  assert.ok(fs.existsSync(path.join(evalDir, "old_skill", "timing.json")));
  assert.equal(fs.existsSync(path.join(evalDir, "without_skill")), false);
  assert.equal(fs.existsSync(path.join(evalDir, "old_skill", "skill")), false);
  const oldOutput = fs.readFileSync(
    path.join(evalDir, "old_skill", "outputs", "output.md"),
    "utf8",
  );
  assert.match(oldOutput, /snapshot=true/);
  assert.match(oldOutput, /current=false/);
});

test("run_skill_evals fails rather than writing timing without token usage", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });

  const fakeClaude = writeFakeClaude(
    fixture.root,
    `
const prompt = process.argv.at(-1) || "";
process.stdout.write(JSON.stringify({ result: "review output\\n" }) + "\\n");
`,
  );

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CLAUDE_BIN: fakeClaude } },
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Claude output did not include total token usage; cannot write timing\.json/,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        fixture.workspace,
        "iteration-1",
        "eval-sample-1",
        "with_skill",
        "transcript.json",
      ),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        fixture.workspace,
        "iteration-1",
        "eval-sample-1",
        "with_skill",
        "timing.json",
      ),
    ),
    false,
  );
});

test("run_skill_evals stops before grading and benchmarking failed agent runs", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });

  const fakeClaude = writeFakeClaude(
    fixture.root,
    `
const prompt = process.argv.at(-1) || "";
if (
  prompt.includes("Grade this skill eval run") ||
  prompt.includes("Blindly compare skill eval outputs")
) {
  process.stderr.write("grading should not run after failed eval runs\\n");
  process.exit(42);
}
process.stdout.write(JSON.stringify({
  result: "failed run output\\n",
  usage: { input_tokens: 1, output_tokens: 1 },
  duration_ms: 25
}) + "\\n");
process.exit(7);
`,
  );

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CLAUDE_BIN: fakeClaude } },
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /eval-sample-1 with_skill: exit 7/);
  assert.match(result.stdout, /eval-sample-1 without_skill: exit 7/);
  assert.match(result.stderr, /not grading or benchmarking failed outputs/);
  const iterationDir = path.join(fixture.workspace, "iteration-1");
  const evalDir = path.join(iterationDir, "eval-sample-1");
  assert.ok(fs.existsSync(path.join(evalDir, "with_skill", "timing.json")));
  assert.equal(
    fs.existsSync(path.join(evalDir, "with_skill", "grading.json")),
    false,
  );
  assert.equal(fs.existsSync(path.join(iterationDir, "benchmark.json")), false);
});

test("typescript eval 4 fixture expects explicit available cases", () => {
  const fixtureSource = fs.readFileSync(
    path.join(
      repoRoot,
      "typescript-best-practice",
      "evals",
      "files",
      "eval-4.ts",
    ),
    "utf8",
  );
  const evalsJson = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "typescript-best-practice", "evals", "evals.json"),
      "utf8",
    ),
  );
  const evalCase = evalsJson.evals.find(
    (candidate: { id: number }) => candidate.id === 4,
  );

  assert.doesNotMatch(fixtureSource, /\boffline\b/);
  assert.match(fixtureSource, /"connected"/);
  assert.match(fixtureSource, /"ready"/);
  assert.match(fixtureSource, /default:\s*\n\s*return "Available"/);
  assert.match(
    evalCase.expected_output,
    /explicit `connected` and `ready` cases/,
  );
  assert.match(evalCase.expected_output, /never-based exhaustive check/);
});

test("typescript verifier checks eval 4 explicit available case assertions", (t) => {
  const assertion =
    'The output shows explicit `case "connected"` and `case "ready"` branches that return `Available`.';
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 4,
          prompt: "Review evals/files/eval-4.ts.",
          expected_output:
            "Recommends explicit connected and ready cases that return Available.",
          files: ["evals/files/eval-4.ts"],
          assertions: [assertion],
        },
      ],
    },
    files: {
      "evals/files/eval-4.ts":
        'type ConnectionState = "connecting" | "connected" | "reconnecting" | "ready";\n',
    },
  });
  const outputDir = path.join(fixture.root, "outputs");
  fs.mkdirSync(outputDir);
  fs.writeFileSync(
    path.join(outputDir, "output.md"),
    'Use case "connected": and case "ready":, then return "Available".\n',
  );

  const result = runNode(
    path.join(repoRoot, "typescript-best-practice", "evals", "verify.cjs"),
    [
      "--evals-json",
      path.join(fixture.skillPath, "evals", "evals.json"),
      "--eval-id",
      "4",
      "--output-dir",
      outputDir,
    ],
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    assertion_results: [
      {
        text: assertion,
        passed: true,
        evidence:
          'Checked for explicit case "connected" and case "ready" branches returning Available.',
      },
    ],
  });
});

test("run_skill_evals uses deterministic verification scripts before LLM grading", (t) => {
  const assertion = "The output reports the expected issue.";
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: [assertion],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
      "evals/verify.cjs": `
const fs = require("node:fs");
const evalsJsonPath = process.argv[process.argv.indexOf("--evals-json") + 1];
const evalId = Number(process.argv[process.argv.indexOf("--eval-id") + 1]);
const runConfiguration =
  process.argv[process.argv.indexOf("--run-configuration") + 1];
const evalsJson = JSON.parse(fs.readFileSync(evalsJsonPath, "utf8"));
const evalCase = evalsJson.evals.find((candidate) => candidate.id === evalId);
process.stdout.write(JSON.stringify({
  assertion_results: evalCase.assertions.map((text) => ({
    text,
    passed: true,
    evidence: "Verified mechanically for " + runConfiguration
  }))
}) + "\\n");
`,
    },
  });

  const fakeClaude = writeFakeClaude(
    fixture.root,
    `
const prompt = process.argv.at(-1) || "";
if (prompt.includes("Grade this skill eval run")) {
  process.stderr.write("LLM grading should not run\\n");
  process.exit(42);
}
if (prompt.includes("Blindly compare skill eval outputs")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      preferred_output: "tie",
      scores: { A: 3, B: 3 },
      rationale: "Both outputs are equivalent.",
      actionable_feedback: ""
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({
  result: "review output\\n",
  usage: { input_tokens: 10, output_tokens: 5 }
}) + "\\n");
`,
  );

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CLAUDE_BIN: fakeClaude } },
  );

  assert.equal(result.status, 0, result.stderr);
  const grading = JSON.parse(
    fs.readFileSync(
      path.join(
        fixture.workspace,
        "iteration-1",
        "eval-sample-1",
        "with_skill",
        "grading.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(grading.assertion_results, [
    {
      text: assertion,
      passed: true,
      evidence: "Verified mechanically for with_skill",
    },
  ]);
});

test("run_skill_evals combines partial deterministic grading with LLM grading in assertion order", (t) => {
  const llmAssertion = "The output describes the human-facing issue.";
  const deterministicAssertion = "The output includes the required marker.";
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review fixture behavior.",
          expected_output: "Reports the expected issue and marker.",
          files: ["evals/files/sample.ts"],
          assertions: [llmAssertion, deterministicAssertion],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
      "evals/verify.cjs": `
const fs = require("node:fs");
const evalsJsonPath = process.argv[process.argv.indexOf("--evals-json") + 1];
const evalId = Number(process.argv[process.argv.indexOf("--eval-id") + 1]);
const runConfiguration =
  process.argv[process.argv.indexOf("--run-configuration") + 1];
const evalsJson = JSON.parse(fs.readFileSync(evalsJsonPath, "utf8"));
const evalCase = evalsJson.evals.find((candidate) => candidate.id === evalId);
const assertion = evalCase.assertions.find((text) => text.includes("marker"));
process.stdout.write(JSON.stringify({
  assertion_results: [
    {
      text: assertion,
      passed: true,
      evidence: "Verified marker mechanically for " + runConfiguration
    }
  ]
}) + "\\n");
`,
    },
  });

  const fakeClaude = writeFakeClaude(
    fixture.root,
    `
const prompt = process.argv.at(-1) || "";
if (prompt.includes("Grade this skill eval run")) {
  if (prompt.includes("The output includes the required marker.")) {
    process.stderr.write("deterministic assertion should not be LLM graded\\n");
    process.exit(42);
  }
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      assertion_results: [
        {
          text: "The output describes the human-facing issue.",
          passed: false,
          evidence: "outputs/output.md omits the human-facing explanation"
        }
      ],
      summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 }
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
if (prompt.includes("Blindly compare skill eval outputs")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      preferred_output: "tie",
      scores: { A: 3, B: 3 },
      rationale: "Both outputs are equivalent.",
      actionable_feedback: ""
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({
  result: "review output with marker\\n",
  usage: { input_tokens: 1, output_tokens: 1 }
}) + "\\n");
`,
  );

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CLAUDE_BIN: fakeClaude } },
  );

  assert.equal(result.status, 0, result.stderr);
  const grading = JSON.parse(
    fs.readFileSync(
      path.join(
        fixture.workspace,
        "iteration-1",
        "eval-fixture-behavior-1",
        "with_skill",
        "grading.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(grading.assertion_results, [
    {
      text: llmAssertion,
      passed: false,
      evidence: "outputs/output.md omits the human-facing explanation",
    },
    {
      text: deterministicAssertion,
      passed: true,
      evidence: "Verified marker mechanically for with_skill",
    },
  ]);
  assert.deepEqual(grading.summary, {
    passed: 1,
    failed: 1,
    total: 2,
    pass_rate: 0.5,
  });
});

test("run_skill_evals requires an old skill path when no workspace snapshot exists", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });

  const result = runNode(runScript, [
    fixture.skillPath,
    "--workspace",
    fixture.workspace,
    "--iteration",
    "1",
    "--baseline",
    "old_skill",
  ]);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /--old-skill-path is required for old_skill unless <workspace>\/skill-snapshot already exists/,
  );
  const workspaceSnapshot = path.join(fixture.workspace, "skill-snapshot");
  assert.equal(fs.existsSync(workspaceSnapshot), false);
  assert.equal(
    fs.existsSync(path.join(fixture.workspace, "iteration-1")),
    false,
  );
});

test("run_skill_evals uses an existing workspace snapshot when old_skill path is omitted", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });
  const workspaceSnapshot = path.join(fixture.workspace, "skill-snapshot");
  fs.mkdirSync(fixture.workspace, { recursive: true });
  fs.cpSync(fixture.skillPath, workspaceSnapshot, { recursive: true });
  fs.appendFileSync(
    path.join(workspaceSnapshot, "SKILL.md"),
    "\nSNAPSHOT_ONLY\n",
  );
  fs.appendFileSync(
    path.join(fixture.skillPath, "SKILL.md"),
    "\nCURRENT_ONLY\n",
  );
  const fakeClaude = writeFakeClaude(
    fixture.root,
    `
const fs = require("node:fs");
const prompt = process.argv.at(-1) || "";
if (prompt.includes("Grade this skill eval run")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      assertion_results: [
        {
          text: "The output reports the expected issue.",
          passed: true,
          evidence: "outputs/output.md records the existing snapshot marker"
        }
      ],
      summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 }
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
if (prompt.includes("Blindly compare skill eval outputs")) {
  process.stdout.write(JSON.stringify({
    result: JSON.stringify({
      preferred_output: "tie",
      scores: { A: 3, B: 3 },
      rationale: "Both outputs are equivalent.",
      actionable_feedback: ""
    }),
    usage: { input_tokens: 1, output_tokens: 1 }
  }) + "\\n");
  process.exit(0);
}
const skill = fs.readFileSync("SKILL.md", "utf8");
process.stdout.write(JSON.stringify({
  result: [
    "cwd=" + process.cwd(),
    "snapshot=" + skill.includes("SNAPSHOT_ONLY"),
    "current=" + skill.includes("CURRENT_ONLY")
  ].join("\\n") + "\\n",
  usage: { input_tokens: 1, output_tokens: 1 }
}) + "\\n");
`,
  );

  const result = runNode(
    runScript,
    [
      fixture.skillPath,
      "--workspace",
      fixture.workspace,
      "--iteration",
      "1",
      "--baseline",
      "old_skill",
    ],
    { env: { SKILL_EVAL_CLAUDE_BIN: fakeClaude } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.existsSync(
      path.join(fixture.workspace, "iteration-1", "iteration_metadata.json"),
    ),
    false,
  );
  const oldOutput = fs.readFileSync(
    path.join(
      fixture.workspace,
      "iteration-1",
      "eval-sample-1",
      "old_skill",
      "outputs",
      "output.md",
    ),
    "utf8",
  );
  assert.equal(
    fs.existsSync(
      path.join(
        fixture.workspace,
        "iteration-1",
        "eval-sample-1",
        "old_skill",
        "skill",
      ),
    ),
    false,
  );
  assert.match(oldOutput, /snapshot=true/);
  assert.match(oldOutput, /current=false/);
});
