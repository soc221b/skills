# Narrowing Domain Types

**Rule:** Put domain restrictions in source signatures instead of forcing callers to recover them with assertions.

**Read when:** Callers cast a broad return value or pass unchecked strings, numbers, or literals into an API whose valid domain is narrower.

❌ **Don't** define source types that are wider than the real domain:

```ts
/* WRONG: the parameter type loses the tag-name-to-element mapping */
declare function queryTag(tagName: string): Element | null;

const inputElement: HTMLInputElement | null = queryTag(
  "non-input-tag",
) as HTMLInputElement | null;
```

✅ **Do** encode the valid domain in the source type:

```ts
/* OK: the parameter type preserves the tag-name-to-element mapping */
declare function queryTag<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
): HTMLElementTagNameMap[K] | null;

const inputElement: HTMLInputElement | null = queryTag("non-input-tag"); // Error: not a key of HTMLElementTagNameMap.
```

**Allowed exception:** Use a broad input type when the domain genuinely accepts that broad set, or when the value is raw boundary data that will be validated before becoming a domain value.

❔ **Why:** Broad source types do not show the domain rules. They let unsupported states or values pass TypeScript, so consumers must use assertions or extra checks.
