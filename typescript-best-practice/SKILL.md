---
name: typescript-best-practice
description: Reviews and refactors TypeScript code using type-system best practices that linters may miss. Use when checking TypeScript quality, reducing unsafe assertions, modeling domain states, validating boundary data, or replacing internal runtime checks with stronger static types.
---

# TypeScript Best Practice

## When To Use

Use this skill for TypeScript review or refactoring when the issue is type soundness, domain modeling, boundary validation, or an unsafe escape hatch that ESLint may not catch. Do not use it as a general TypeScript syntax tutorial.

## Default Workflow

1. Inspect the target code, nearby types, public API surface, and existing validation tools.
2. Pick the relevant rules from the reference map. Read only those files.
3. Prefer a static type model for internal code; validate data only at real trust boundaries.
4. Preserve established local patterns unless they are the source of the type problem.
5. Run the narrowest useful feedback loop: `tsc --noEmit`, project typecheck, lint, tests, or reviewer line checks.
6. If validation fails, decide whether the model is wrong or the implementation is incomplete, then iterate once before reporting.

## Decision Defaults

- Use discriminated unions, mapped types, keyed generics, overloads, and `satisfies` before adding internal runtime checks.
- Use the schema or validation library already present in the repository for untrusted data. Do not add a dependency only to satisfy an example.
- Keep assertions rare, local, and justified by a runtime proof or platform invariant visible in the same module.
- For reviews, lead with concrete findings and cite the exact file and line. For refactors, make the smallest change that removes the invalid state.

## Reference Map

- [Avoiding invalid catchall overloads](references/avoiding-invalid-catchall-overloads.md): Public overloads expose only supported call shapes.
- [Avoiding object iteration assertions](references/avoiding-object-iteration-assertions.md): Object iteration keys need a known key tuple or runtime guard.
- [Avoiding `Record<string, T>` for known keys](references/avoiding-record-string-for-known-keys.md): Known key spaces use key unions or mapped types.
- [Checking closed sets exhaustively](references/checking-closed-sets-exhaustively.md): Closed finite sets use explicit handling or intentional shared defaults.
- [Inverting dependencies at type boundaries](references/inverting-dependencies-at-type-boundaries.md): Local APIs expose local contracts, not upstream implementation types.
- [Inverting domain value dependencies](references/inverting-domain-value-dependencies.md): Domain-owned runtime values are the source of truth for derived types and schemas.
- [Modeling exclusive options](references/modeling-exclusive-options.md): Mutually exclusive options are encoded as variants.
- [Narrowing correlated state types](references/narrowing-correlated-state-types.md): Discriminants and dependent values stay in the same union variant.
- [Narrowing domain types](references/narrowing-domain-types.md): Source signatures encode the real domain instead of forcing caller assertions.
- [Preserving correlated parameters](references/preserving-correlated-parameters.md): Parameter types preserve relationships between discriminants and dependent values.
- [Validating boundary data](references/validating-boundary-data.md): Untrusted data is parsed and validated where it enters the process.

## Adding Or Revising Rules

Use one reference file per rule. Keep every reference directly linked from this file and avoid nested reference chains.

Reference template:

```markdown
# Gerund Rule Title

**Rule:** One enforceable sentence.

**Read when:** Concrete trigger for opening this file.

[short wrong example]

[short preferred example]

**Allowed exception:** Narrow escape hatch.

**Why:** One paragraph explaining the repeated failure mode.
```

If a reference grows beyond 100 lines, add a `## Contents` table of contents near the top. Keep examples concrete and current; put time-sensitive or deprecated patterns in an explicitly named old-patterns section.
