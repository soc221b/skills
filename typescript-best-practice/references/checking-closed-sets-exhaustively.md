# Checking Closed Sets Exhaustively

Use when branching over a closed finite set: a literal union, union enum, boolean, or finite template-literal type. A shared fallback is okay only when future members should intentionally inherit it.

- [ ] Identify the closed type and missing member.
- [ ] Enumerate every current member explicitly, even when members share behavior.
- [ ] Reserve the final fallback for a throwing `never` exhaustiveness guard.
- [ ] Reject `default`, final `else`, lookup fallback, or fallback return handling of known members.
- [ ] Remove fake fallback widening, such as `string | undefined`.

```ts
default: {
  const _exhaustive: never = value;
  throw new Error(`Unhandled value: ${_exhaustive}`);
}
```

Output actions to fix each issue found.
