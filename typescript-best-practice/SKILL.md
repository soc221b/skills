---
name: typescript-best-practice
description: TypeScript best-practice rules that ESLint cannot always check. Use when Codex is asked to improve TypeScript quality, review TypeScript code, or decide whether code should use static types instead of runtime checks.
---

# TypeScript Best Practice

## Workflow

Use this skill for TypeScript code quality rules that ESLint cannot always check.

1. Find the matching rule files in `references/`.
2. Read only the rule files that match the task.
3. Apply the rule in a way that fits the repository's design and validation tools.
4. Prefer static types, discriminated unions, typed boundaries, and schema validation at real trust boundaries over custom runtime checks in internal code.

## Rules

- [Avoiding invalid catchall overloads](references/avoiding-invalid-catchall-overloads.md): Must not add public catchall overloads that make unsupported calls pass TypeScript.
- [Avoiding object iteration assertions](references/avoiding-object-iteration-assertions.md): Must not assert `Object.entries`/`keys`/`values` back to a narrow key type; use a runtime guard or iterate a known key tuple instead.
- [Avoiding `Record<string, T>` for known keys](references/avoiding-record-string-for-known-keys.md): Must not use `Record<string, T>` when the valid key space is known; encode the key union or mapped type.
- [Checking closed sets exhaustively](references/checking-closed-sets-exhaustively.md): Must use exhaustive `satisfies never` checks when branching over closed finite sets unless a `default` branch intentionally models shared behavior for all remaining members.
- [Inverting dependencies at type boundaries](references/inverting-dependencies-at-type-boundaries.md): Must define local API contracts first and keep library, SDK, framework, or platform types behind the boundary as implementation details.
- [Inverting domain value dependencies](references/inverting-domain-value-dependencies.md): Must define domain-owned runtime values first, then derive types, validators, adapters, and other implementation details from them.
- [Modeling exclusive options](references/modeling-exclusive-options.md): Must not model mutually exclusive options as independent optional fields; use a discriminated union or exact variant types.
- [Narrowing correlated state types](references/narrowing-correlated-state-types.md): Must not model correlated states with broad fields that allow invalid combinations to pass TypeScript.
- [Narrowing domain types](references/narrowing-domain-types.md): Must not define broad source types when a narrower domain type can encode the valid states.
- [Preserving correlated parameters](references/preserving-correlated-parameters.md): Must not model correlated parameters as independent unions when one parameter determines the valid type of another; preserve the correlation with overloads, keyed generics, discriminated tuples, or a discriminated parameter object.
- [Validating boundary data](references/validating-boundary-data.md): Must not cast untrusted boundary data, including but not limited to HTTP responses, `JSON.parse`, env vars, storage, messages, sockets, or CLI input; validate it with Zod or a similar schema library instead.

## Adding Rules

When adding a new rule:

1. Create one file per rule in `references/`.
2. Name each file with a consistent gerund-form, lowercase hyphen-case title, such as `avoiding-invalid-catchall-overloads.md` for `# Avoiding Invalid Catchall Overloads`.
3. Add a short linked entry under `Rules` that explains when to read the file.
4. Keep `SKILL.md` as the index. Put detailed reasons, examples, and exceptions in the rule file.
