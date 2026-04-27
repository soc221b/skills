# Modeling Exclusive Options

**Rule:** Mutually exclusive states must be encoded as variants, not as independent optional fields.

❌ **Don't** model mutually exclusive options as independent optional fields:

```ts
/* WRONG: a React input can be both controlled and uncontrolled */
import type { ChangeEventHandler } from "react";

type TextInputValueProps = {
  value?: string;
  defaultValue?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
};
```

✅ **Do** encode each valid option set as its own variant:

```ts
/* OK: each variant contains exactly the fields that belong together */
import type { ChangeEventHandler } from "react";

type TextInputValueProps =
  | {
      defaultValue?: never;
      onChange: ChangeEventHandler<HTMLInputElement>;
      value: string;
    }
  | {
      defaultValue?: string;
      onChange?: ChangeEventHandler<HTMLInputElement>;
      value?: never;
    };
```

**Allowed exception:** Independent optional fields are fine only when every combination is valid and the implementation handles each combination intentionally.

❔ **Why:** Independent optional fields cannot express exclusivity. A discriminated union makes invalid combinations fail TypeScript instead of requiring callers or implementations to discover them later.
