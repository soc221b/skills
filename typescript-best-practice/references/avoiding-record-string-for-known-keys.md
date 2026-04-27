# Avoiding Record String for Known Keys

**Rule:** Use `Record<string, T>` only for true string-indexed dictionaries. Use key unions or mapped types for known key spaces.

❌ **Don't** use `Record<string, T>` when the valid key space is known:

```ts
/* WRONG: any string is accepted and event-specific payload types are lost */
type HTMLElementEventHandlers = Record<string, (event: Event) => void>;
```

✅ **Do** encode the key space and preserve key-specific value types:

```ts
/* OK: only HTMLElement event names are accepted */
type HTMLElementEventHandlers = {
  [K in keyof HTMLElementEventMap]?: (
    event: HTMLElementEventMap[K],
  ) => void;
};
```

**Allowed exception:** Keep `Record<string, T>` or an index signature when the domain really accepts arbitrary string keys, such as user-defined labels, cache buckets, or normalized lookup tables.

❔ **Why:** `Record<string, T>` means arbitrary string keys are valid. Known key spaces should be represented as key unions or mapped types so TypeScript can reject unsupported keys and preserve key-specific value information.
