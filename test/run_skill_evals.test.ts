import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  makeSkillFixture,
  runNode,
  runScript,
} from "../test_support/skill_eval_fixtures.ts";

function writeFakeCodex(
  fixtureRoot: string,
  body: string = `
const fs = require("node:fs");
const outputIndex = process.argv.indexOf("-o");
if (outputIndex !== -1) {
  fs.writeFileSync(process.argv[outputIndex + 1], "review output\\n");
}
process.stdout.write(JSON.stringify({
  type: "turn.completed",
  usage: {
    input_tokens: 10,
    output_tokens: 5
  }
}) + "\\n");
`,
): string {
  const fakeCodex = path.join(fixtureRoot, "fake-codex.cjs");
  fs.writeFileSync(fakeCodex, `#!/usr/bin/env node\n${body}`);
  fs.chmodSync(fakeCodex, 0o755);
  return fakeCodex;
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
    { env: { SKILL_EVAL_CODEX_BIN: writeFakeCodex(fixture.root) } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /eval-sample with_skill: exit 0/);
  assert.match(result.stdout, /eval-sample without_skill: exit 0/);

  const iterationDir = path.join(fixture.workspace, "iteration-1");
  const evalDir = path.join(iterationDir, "eval-sample");
  assert.ok(
    fs.existsSync(path.join(evalDir, "with_skill", "outputs", "output.md")),
  );
  assert.ok(fs.existsSync(path.join(evalDir, "with_skill", "timing.json")));
  assert.ok(
    fs.existsSync(path.join(evalDir, "without_skill", "outputs", "output.md")),
  );
  assert.ok(fs.existsSync(path.join(evalDir, "without_skill", "timing.json")));
  assert.equal(fs.existsSync(path.join(evalDir, "eval_metadata.json")), false);
  assert.equal(
    fs.existsSync(path.join(iterationDir, "run_summary.json")),
    false,
  );

  const timing = JSON.parse(
    fs.readFileSync(path.join(evalDir, "with_skill", "timing.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(timing).sort(), ["duration_ms", "total_tokens"]);
  assert.equal(timing.total_tokens, 15);
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
    { env: { SKILL_EVAL_CODEX_BIN: writeFakeCodex(fixture.root) } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /eval-review-the-skill-instructions with_skill/);
  assert.match(
    result.stdout,
    /eval-review-the-skill-instructions without_skill/,
  );
  assert.ok(
    fs.existsSync(
      path.join(
        fixture.workspace,
        "iteration-1",
        "eval-review-the-skill-instructions",
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

  const fakeCodex = writeFakeCodex(
    fixture.root,
    `
const fs = require("node:fs");
const outputIndex = process.argv.indexOf("-o");
if (outputIndex !== -1) {
  fs.writeFileSync(process.argv[outputIndex + 1], [
    "cwd=" + process.cwd(),
    "input=" + fs.existsSync("evals/files/sample.ts"),
    "skill=" + fs.existsSync("SKILL.md"),
    "reference=" + fs.existsSync("references/skill-only.md")
  ].join("\\n") + "\\n");
}
process.stdout.write(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 2 } }) + "\\n");
`,
  );

  const result = runNode(
    runScript,
    [fixture.skillPath, "--workspace", fixture.workspace, "--iteration", "1"],
    { env: { SKILL_EVAL_CODEX_BIN: fakeCodex } },
  );

  assert.equal(result.status, 0, result.stderr);

  const runDir = path.join(
    fixture.workspace,
    "iteration-1",
    "eval-sample",
    "without_skill",
  );
  const inputDir = path.join(runDir, "input");
  assert.equal(
    fs.readFileSync(path.join(inputDir, "evals/files/sample.ts"), "utf8"),
    "const value = 1;\n",
  );
  assert.equal(fs.existsSync(path.join(inputDir, "SKILL.md")), false);
  assert.equal(
    fs.existsSync(path.join(inputDir, "references/skill-only.md")),
    false,
  );

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
  assert.equal(outputLines.cwd, fs.realpathSync(inputDir));
  assert.match(output, /input=true/);
  assert.match(output, /skill=false/);
  assert.match(output, /reference=false/);
});

test("run_skill_evals uses the previous skill snapshot for old_skill baseline", (t) => {
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
    { env: { SKILL_EVAL_CODEX_BIN: writeFakeCodex(fixture.root) } },
  );

  assert.equal(result.status, 0, result.stderr);
  const evalDir = path.join(fixture.workspace, "iteration-1", "eval-sample");
  assert.ok(fs.existsSync(path.join(evalDir, "with_skill", "timing.json")));
  assert.ok(fs.existsSync(path.join(evalDir, "old_skill", "timing.json")));
  assert.equal(fs.existsSync(path.join(evalDir, "without_skill")), false);
});

test("run_skill_evals requires an old skill path for old_skill baseline", (t) => {
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
  });

  const result = runNode(runScript, [
    fixture.skillPath,
    "--workspace",
    fixture.workspace,
    "--baseline",
    "old_skill",
  ]);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /--old-skill-path is required when running old_skill/,
  );
});
