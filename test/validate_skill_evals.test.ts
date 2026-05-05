import assert from "node:assert/strict";
import test from "node:test";

import {
  makeSkillFixture,
  runNode,
  validateScript,
} from "../test_support/skill_eval_fixtures.ts";

function assertValidationSuccess(result: ReturnType<typeof runNode>): void {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, ".\n");
}

function assertValidationFailure(
  result: ReturnType<typeof runNode>,
  message: string,
): void {
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.match(
    result.stdout,
    /^X\n\nFailed tests:\n\n✖ validate_skill_evals \(\d+\.\d{6}ms\)\n  Error: /,
  );
  assert.ok(result.stdout.includes(message), result.stdout);
}

test("validate_skill_evals accepts a compliant evals.json", (t) => {
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

  const result = runNode(validateScript, [], { cwd: fixture.root });

  assertValidationSuccess(result);
});

test("validate_skill_evals accepts evals without optional files", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
  });

  const result = runNode(validateScript, [], { cwd: fixture.root });

  assertValidationSuccess(result);
});

test("validate_skill_evals rejects non-integer eval IDs", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: "sample-review",
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
  });

  const result = runNode(validateScript, [], { cwd: fixture.root });

  assertValidationFailure(result, "evals[0].id must be a unique integer");
});

test("validate_skill_evals accepts evals without optional assertions", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });

  const result = runNode(validateScript, [], { cwd: fixture.root });

  assertValidationSuccess(result);
});

test("validate_skill_evals rejects malformed assertions", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/sample.ts"],
          assertions: [""],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });

  const result = runNode(validateScript, [], { cwd: fixture.root });

  assertValidationFailure(
    result,
    "evals[0].assertions[0] must be a non-empty string",
  );
});

test("validate_skill_evals rejects optional fields with malformed present values", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: null,
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
  });

  const result = runNode(validateScript, [], { cwd: fixture.root });

  assertValidationFailure(result, "evals[0].files must be an array");
});

test("validate_skill_evals rejects missing referenced files", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["evals/files/missing.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
  });

  const result = runNode(validateScript, [], { cwd: fixture.root });

  assertValidationFailure(
    result,
    "evals[0].files[0] references missing file: evals/files/missing.ts",
  );
});

test("validate_skill_evals rejects absolute input file paths", (t) => {
  const fixture = makeSkillFixture(t, {
    evalsJson: {
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Review evals/files/sample.ts.",
          expected_output: "Reports the expected issue.",
          files: ["/tmp/sample.ts"],
          assertions: ["The output reports the expected issue."],
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });

  const result = runNode(validateScript, [], { cwd: fixture.root });

  assertValidationFailure(
    result,
    "evals[0].files[0] must be a relative path inside the skill directory: /tmp/sample.ts",
  );
});

test("validate_skill_evals rejects fields outside the documented evals schema", (t) => {
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
          grading: "manual",
        },
      ],
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });

  const result = runNode(validateScript, [], { cwd: fixture.root });

  assertValidationFailure(
    result,
    "evals[0].grading is not defined by the skill evals schema",
  );
});

test("validate_skill_evals rejects top-level fields outside the documented evals schema", (t) => {
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
      benchmark: {},
    },
    files: {
      "evals/files/sample.ts": "const value = 1;\n",
    },
  });

  const result = runNode(validateScript, [], { cwd: fixture.root });

  assertValidationFailure(
    result,
    "evals.json.benchmark is not defined by the skill evals schema",
  );
});
