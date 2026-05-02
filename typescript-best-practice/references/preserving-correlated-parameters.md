# Preserving Correlated Parameters

**Rule:** When one value determines another value's valid type, preserve that relationship in the parameter type.

**Read when:** A function accepts multiple parameters where one parameter selects the valid shape or type of another parameter.

❌ **Don't** model correlated values as independent union parameters when one parameter determines the valid type of another:

```ts
/* WRONG: the context id and options can be mixed */
declare function getContext(
  contextId: "2d" | "bitmaprenderer",
  options?:
    | CanvasRenderingContext2DSettings
    | ImageBitmapRenderingContextSettings,
): CanvasRenderingContext2D | ImageBitmapRenderingContext | null;

getContext("bitmaprenderer", { colorSpace: "display-p3" });
```

✅ **Do** preserve the correlation with overloads, keyed generics, discriminated tuples, or a discriminated parameter object. Bundling the values into one object is often the clearest fix when the API shape is flexible:

```ts
/* OK: the context id and options stay correlated */
type Canvas2DContextInput = {
  contextId: "2d";
  options?: CanvasRenderingContext2DSettings;
};

type ImageBitmapContextInput = {
  contextId: "bitmaprenderer";
  options?: ImageBitmapRenderingContextSettings;
};

declare function getContext(
  input: Canvas2DContextInput,
): CanvasRenderingContext2D | null;
declare function getContext(
  input: ImageBitmapContextInput,
): ImageBitmapRenderingContext | null;

getContext({
  contextId: "bitmaprenderer",
  options: { colorSpace: "display-p3" },
}); // Error: 2D-only options are not valid for "bitmaprenderer".
```

**Allowed exception:** Keep independent parameters only when every cross-product combination is valid and tested as intentional behavior.

❔ **Why:** Independent union parameters let callers combine members that do not belong together. Keep the discriminant and dependent value in the same typed variant, or use overloads/keyed generics/rest tuple unions when the existing API needs separate arguments.
