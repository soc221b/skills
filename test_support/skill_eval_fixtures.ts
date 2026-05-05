import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type TestContextLike = {
  after(callback: () => void): void;
};

type SkillFixtureOptions = {
  evalsJson: Record<string, unknown>;
  files?: Record<string, string>;
};

type SkillFixture = {
  root: string;
  skillPath: string;
  workspace: string;
};

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runScript = path.join(repoRoot, "scripts", "run_skill_evals.ts");
const validateScript = path.join(
  repoRoot,
  "scripts",
  "validate_skill_evals.ts",
);

function runNode(
  script: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
  });
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeSkillFixture(
  t: TestContextLike,
  options: SkillFixtureOptions,
): SkillFixture {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "skill-eval-scripts-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const skillPath = path.join(root, "example-skill");
  fs.mkdirSync(path.join(skillPath, "evals"), { recursive: true });
  fs.writeFileSync(
    path.join(skillPath, "SKILL.md"),
    "---\nname: example-skill\ndescription: Test fixture skill.\n---\n\n# Example Skill\n",
  );

  for (const [file, contents] of Object.entries(options.files ?? {})) {
    const filePath = path.join(skillPath, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  writeJson(path.join(skillPath, "evals", "evals.json"), options.evalsJson);

  return {
    root,
    skillPath,
    workspace: path.join(root, "example-skill-workspace"),
  };
}

export { makeSkillFixture, repoRoot, runNode, runScript, validateScript };
