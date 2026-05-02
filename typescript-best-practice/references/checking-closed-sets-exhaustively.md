# Checking Closed Sets Exhaustively

**Rule:** Closed finite sets need exhaustive handling when each member has intentional behavior. Use `default` only for real shared behavior.

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

✅ **Do** keep a `default` branch when it represents real shared behavior for every remaining member:

```ts
/* OK: every non-loading ready state intentionally uses the same label */
function getReadyStateLabel(state: DocumentReadyState): string {
  switch (state) {
    case "loading":
      return "Loading the page";
    default:
      return "Ready to use";
  }
}
```

**Allowed exception:** Use a `default` branch when the domain rule is genuinely "all remaining members share this behavior."

❔ **Why:** Closed sets such as literal unions, union enums, booleans, and finite template-literal types are often extended later. Use a `never`-based exhaustive check when a new member should force a code update. A `default` branch is appropriate when the domain rule is genuinely "all other members behave the same," but it should not be used to avoid modeling known member-specific behavior.
