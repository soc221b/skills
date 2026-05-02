# Avoiding Object Iteration Assertions

**Rule:** Treat object iteration results as runtime strings unless a known key tuple or runtime guard proves the key set.

**Read when:** Code casts `Object.keys`, `Object.values`, `Object.entries`, `for...in`, or `Reflect.ownKeys` results back to a narrow key or value type.

❌ **Don't** assert `Object.entries`/`Object.keys`/`Object.values` results back to a narrow key type:

```ts
/* WRONG: asserts runtime string keys into a narrow key union */
type MediaTrackSettingName = keyof MediaTrackSettings;

declare const settings: MediaTrackSettings;

const entries = Object.entries(settings) as Array<
  [MediaTrackSettingName, MediaTrackSettings[MediaTrackSettingName]]
>;
```

✅ **Do** iterate a known key tuple or narrow keys with a real runtime guard:

```ts
/* OK: the key set is explicit and checked against the source type */
const MEDIA_TRACK_SETTING_NAMES = [
  "width",
  "height",
  "frameRate",
] as const satisfies readonly (keyof MediaTrackSettings)[];

declare const settings: MediaTrackSettings;

const entries = MEDIA_TRACK_SETTING_NAMES.map(
  (name) => [name, settings[name]] as const,
);
```

**Allowed exception:** Iterate as arbitrary strings when the object is intentionally a string-indexed dictionary and any string key is valid for the operation.

❔ **Why:** `Object.keys` and `Object.entries` return `string` keys because TypeScript uses structural typing. A value typed with a narrow object type can still carry extra runtime properties, so asserting object iteration results hides unexpected keys instead of proving they are valid.
