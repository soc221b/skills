# Avoiding Invalid Catchall Overloads

**Rule:** Public overloads must describe only supported call shapes. Keep loose implementation signatures out of the exported type surface.

**Read when:** A function, method, or interface uses overloads plus a broad rest, `any`, `unknown`, or union signature visible to callers.

❌ **Don't** add a public catchall overload that accepts calls the API does not support:

```ts
/* WRONG: exposes a loose rest catchall overload */
interface CanvasDrawImage {
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  drawImage(image: CanvasImageSource, ...coordinates: number[]): void;
}
```

✅ **Do** expose only overloads for supported argument lists:

```ts
/* OK: only the supported argument lists are public */
interface CanvasDrawImage {
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}
```

**Allowed exception:** A broad implementation signature is fine when it is private to the implementation and callers can only see the exact public overloads.

❔ **Why:** Users can call every public overload, so a broad catchall overload can make unsupported calls pass TypeScript.
