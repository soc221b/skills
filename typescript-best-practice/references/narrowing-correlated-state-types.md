# Narrowing Correlated State Types

**Rule:** Keep discriminants and their dependent values in the same union variant so narrowing preserves the correlation.

❌ **Don't** model correlated states with broad fields and then recover the lost correlation with assertions:

```ts
/* WRONG: the type loses the done/value correlation */
type LooseIteratorResult<T, TReturn = unknown> = {
  done?: boolean;
  value: T | TReturn;
};

declare function readReturnValue(value: number): void;
declare function readYieldValue(value: string): void;

declare const result: LooseIteratorResult<string, number>;
if (result.done) {
  readReturnValue(result.value as number);
} else {
  readYieldValue(result.value as string);
}
```

✅ **Do** encode each valid state combination in the source type so invalid combinations cannot be constructed or passed around:

```ts
/* OK: the type carries the done/value correlation */
interface IteratorYieldResult<TYield> {
  done?: false;
  value: TYield;
}

interface IteratorReturnResult<TReturn> {
  done: true;
  value: TReturn;
}

type IteratorResult<T, TReturn = unknown> =
  | IteratorYieldResult<T>
  | IteratorReturnResult<TReturn>;

declare function readReturnValue(value: number): void;
declare function readYieldValue(value: string): void;

declare const result: IteratorResult<string, number>;
if (result.done) {
  readReturnValue(result.value);
} else {
  readYieldValue(result.value);
}
```

❔ **Why:** Assertions weaken the application by hiding invalid state combinations that broad types allow, so encode those combinations in narrower source types and let TypeScript reject unsafe inputs.
