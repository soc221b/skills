# Inverting Dependencies at Type Boundaries

**Rule:** Local APIs should expose contracts owned by their layer; keep upstream implementation contracts behind adapters when those types belong to dependencies outside the module's purpose.

**Read when:** A wrapper, adapter, component, service, hook, or local module exposes upstream implementation types as its public props, parameters, or return values instead of the contract appropriate to that module's role.

❌ **Don't** make an upstream implementation type the public contract for local code:

```ts
/* WRONG: the local wrapper API depends on the entire MUI Input contract */
import type { InputProps } from "@mui/material/Input";
import type { ReactNode } from "react";

type SearchInputProps = InputProps & {
  label: ReactNode;
};
```

✅ **Do** define the local contract first, then adapt it to implementation details behind the boundary:

```ts
/* OK: callers depend on the wrapper's contract, while MUI stays behind it */
import type { ChangeEventHandler, ReactNode } from "react";

type SearchInputProps = {
  label: ReactNode;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
};
```

**Allowed exception:** Re-export an upstream type only when the local module intentionally mirrors that upstream API and does not claim a narrower local contract.

❔ **Why:** Dependency inversion applies to type boundaries too. The module that owns an API should own the contract its callers depend on. The right local contract depends on the module's purpose: a React component may expose React node, event, and element types because React defines that component API, while a React-independent utility should not take React types. Avoid reusing implementation contracts such as MUI `InputProps`, because they expose options the wrapper may not support, make unrelated upstream changes part of the local API, and force callers to depend on details that should be replaceable.
