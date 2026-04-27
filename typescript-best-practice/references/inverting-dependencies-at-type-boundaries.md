# Inverting Dependencies at Type Boundaries

**Rule:** Local APIs should expose local contracts. Keep library, SDK, framework, and platform types behind adapters unless the module is deliberately a pass-through.

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

❔ **Why:** Dependency inversion applies to type boundaries too. The module that owns an API should own the contract its callers depend on, while library, SDK, framework, and platform types stay behind that boundary as implementation details. Reusing an upstream type exposes options the wrapper may not support, makes unrelated upstream changes part of the local API, and forces callers to depend on details that should be replaceable.
