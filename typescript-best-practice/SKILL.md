---
name: typescript-best-practice
description: Reviews and refactors TypeScript code for type-system risks that linters often miss. Use this skill whenever the user asks to review, audit, debug, or refactor TypeScript involving unsafe assertions, broad types, closed unions, overloads, object iteration, domain modeling, boundary validation, or replacing internal runtime checks with stronger static types.
---

# TypeScript Best Practice

## Purpose

Use this skill to find TypeScript designs that compile but still weaken the type model: hidden impossible states, unsafe assertions, broad public contracts, unchecked boundary data, and runtime branches that should be represented statically.

Do not use this skill as a general TypeScript syntax tutorial. Keep the focus on type soundness, domain modeling, and small code changes that make invalid states harder to express.

## Operating Principles

- Let trusted internal code carry precise domain types. Validate data only where it crosses a real trust boundary, such as HTTP, storage, files, environment variables, messages, or CLI input.
- Prefer changing the source type or public contract over patching every call site with assertions.
- Use discriminated unions, mapped types, keyed generics, overloads, `satisfies`, and `never` exhaustiveness checks before adding internal runtime checks.
- Preserve established local patterns unless those patterns are the reason the type model is unsound.
- Keep assertions rare, local, and justified by a runtime proof or platform invariant visible in the same module.
- Avoid new dependencies unless the repository already has no suitable validation or type-level pattern and the user has asked for a larger change.

## Default Workflow

1. Inspect the target code, nearby types, public API surface, and existing validation tools.
2. Identify whether the value is trusted internal data, untrusted boundary data, or a public API contract.
3. Pick the matching rule from the active reference map.
4. Fix the type owner first when possible: the domain type, function signature, overload surface, schema, or adapter that allowed the invalid state.
5. Make the smallest change that removes the unsoundness without widening unrelated behavior.
6. Run the narrowest useful feedback loop: `tsc --noEmit`, project typecheck, lint, tests, or reviewer line checks.
7. If validation fails, decide whether the type model is wrong or the implementation is incomplete, then iterate once before reporting.

## Review Output

When reviewing code, lead with findings. For each issue, include:

- the exact file and line when available;
- the type-system risk, not just the style preference;
- the smallest safer change;
- a short code sketch only when it clarifies the fix.

If no type-system issue is present, say so clearly and mention any residual risk, such as unvalidated external data or a public API whose callers were not inspected.

## Refactor Output

When editing code, keep the diff focused on the type problem. Prefer one clear owner change plus direct call-site updates over broad rewrites. After editing, report what was changed and which check was run. If no check could be run, say why.

## Reference Map

Read only the files that match the issue.

- [Checking closed sets exhaustively](references/checking-closed-sets-exhaustively.md): Closed finite sets use explicit handling or intentional shared defaults.

## Common Fix Shapes

- Closed finite sets: handle every member explicitly when behavior differs, and use a `never` assignment in the final branch to make future omissions fail typecheck.
- Boundary data: parse or validate once at the entry point, then pass typed domain values through internal code.
- Broad keys: replace `Record<string, T>` or string index signatures with key unions or mapped types when the key space is finite.
- Correlated values: keep the discriminant and dependent fields in the same union variant, or make the function generic over the discriminant so the relationship survives.
- Public overloads: expose only supported call shapes; keep the broad implementation signature private.
- Object iteration: avoid casting arbitrary `Object.keys` results to narrow keys unless a known key tuple or runtime guard proves the key set.
- Exclusive options: model mutually exclusive shapes as variants instead of independent optional properties.

## Adding Or Revising Rules

Use one reference file per promoted rule. Keep every active reference directly linked from this file and avoid nested reference chains.

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
