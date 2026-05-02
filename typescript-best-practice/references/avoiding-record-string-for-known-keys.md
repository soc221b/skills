# Avoiding Record String for Known Keys

**Rule:** Use `Record<string, T>` only for true string-indexed dictionaries. Use key unions or mapped types for known key spaces, and make generic key parameters required unless they default to a real finite domain key union.

**Read when:** A type uses `Record<string, T>`, a string index signature, or a generic key parameter defaulting to `string`, but the allowed keys are a finite union, enum-like value list, or framework map.

❌ **Don't** model known keys as arbitrary strings, including through `Record<string, T>` or a generic default:

```ts
/* WRONG: any string is accepted and event-specific payload types are lost */
type HTMLElementEventHandlers = Record<string, (event: Event) => void>;
```

```ts
/* WRONG: omitting TEventName still accepts any event name */
interface HTMLElementEventHandlers<TEventName extends string> {
  handlers: {
    [K in TEventName]?: (event: Event) => void;
  };
}
```

✅ **Do** encode the key space, preserve key-specific value types, and require the generic key union unless it defaults to a domain-owned finite union:

```ts
/* OK: only HTMLElement event names are accepted */
type HTMLElementEventHandlers = {
  [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void;
};
```

```ts
/* OK: callers must provide or infer the known event name union */
interface HTMLElementEventHandlers<
  TEventName extends keyof HTMLElementEventMap,
> {
  handlers: {
    [K in TEventName]?: (event: HTMLElementEventMap[K]) => void;
  };
}
```

**Allowed exception:** Keep `Record<string, T>` or an index signature when the domain really accepts arbitrary string keys, such as user-defined labels, cache buckets, or normalized lookup tables.

❔ **Why:** `Record<string, T>` and `T extends string = string` both mean arbitrary string keys are valid. Known key spaces should be represented as key unions or mapped types so TypeScript can reject unsupported keys and preserve key-specific value information.
