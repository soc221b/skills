# Checking Closed Sets Exhaustively

**Rule:** Closed finite sets should enumerate known members explicitly, even when multiple members currently share behavior. Reserve `default` for a `never`-based exhaustive check.

**Read when:** A `switch`, `if` chain, lookup map, or formatter branches over a literal union, boolean, union enum, or finite template-literal type.

❌ **Don't** add a catch-all fallback when each member needs intentional handling:

```ts
/* WRONG: "complete" needs its own label, but the fallback hides that gap */
function getReadyStateLabel(state: DocumentReadyState): string {
  switch (state) {
    case "loading":
      return "Loading the page";
    case "interactive":
      return "Ready to use";
  }

  return "Status unavailable";
}
```

✅ **Do** add a `never`-based exhaustive check when all current variants should be handled explicitly:

```ts
/* OK: adding a DocumentReadyState variant breaks this switch */
function getReadyStateLabel(state: DocumentReadyState): string {
  switch (state) {
    case "loading":
      return "Loading the page";
    case "interactive":
      return "Ready to use";
    case "complete":
      return "Page loaded";
    default: {
      state satisfies never;
      throw new Error("Unhandled document ready state");
    }
  }
}
```

✅ **Do** spell out known members even when they share a return value, then keep `default` for exhaustiveness:

```ts
/* OK: future DocumentReadyState variants break this switch */
function getReadyStateLabel(state: DocumentReadyState): string {
  switch (state) {
    case "loading":
      return "Loading the page";
    case "interactive":
    case "complete":
      return "Ready to use";
    default:
      state satisfies never;
      throw new Error("Unhandled document ready state");
  }
}
```

**Allowed exception:** Use a real shared `default` only when the domain is intentionally catch-all and a future member should inherit that behavior without forcing a code update.

❔ **Why:** Closed sets such as literal unions, union enums, booleans, and finite template-literal types are often extended later. A shared `default` return makes known members look indistinguishable from future members, so new cases can slip through silently. Explicit cases document the current domain, while a `never`-based `default` makes omissions fail typecheck.
