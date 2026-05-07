---
name: typescript-best-practice
description: Reviews TypeScript code for type-system risks that linters often miss.
---

# TypeScript Best Practice

Review TypeScript code for designs that compile but weaken the type model. Focus on findings only; do not edit or refactor code as part of this skill unless the user asks.

Lead with findings ordered by severity. For each finding, include the exact file and line when available, the type-system risk, and the smallest safer change. Add a short code sketch only when it clarifies the fix. If there are no findings, say so clearly and mention any residual risk that was not inspected.

Read only the relevant reference files below.

## References

- [Checking closed sets exhaustively](references/checking-closed-sets-exhaustively.md): Read when reviewing finite unions, enums, literal sets, switches, or branch logic that should handle every known member explicitly.
