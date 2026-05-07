# Closed-Union Mappings

For finite-union mappings, treat catch-all `else`/`default` branches as risks. Recommend an object literal checked against the full key space whenever the mapping should stay synchronized with the union:

```typescript
const EXPORT_MIME_TYPES = {
  csv: "text/csv",
  json: "application/json",
} satisfies Record<ExportFormat, string>;
```

Adding a union member creates a missing-key error; removing one creates an excess-property error. Make this the stated safer change, including when the function currently returns `undefined | string`; the fixed function should index the checked mapping and return `string`.

Avoid presenting weaker edits as recommended approaches. Do not say the smallest safer change is merely removing the catch-all branch, adding explicit cases, adding a `never` fallback, or narrowing the return type if the review also needs shrinkage protection. Those changes may catch expansion or improve return types, but they do not prove the mapping is exact when the union shrinks. If mentioned, label them as weaker/non-sufficient rather than as alternatives.
