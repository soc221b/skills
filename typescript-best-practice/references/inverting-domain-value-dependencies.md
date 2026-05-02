# Inverting Domain Value Dependencies

**Rule:** Domain-owned runtime values should be the source of truth. Derive types, schemas, options, and adapters from those values.

**Read when:** A domain union is inferred from a schema, UI options, SDK enum, adapter table, or other implementation detail that the domain should own.

❌ **Don't** make an implementation detail the source of truth for domain-owned values:

```ts
import { z } from "zod";

/* WRONG: the domain type depends on an implementation detail */
const PrinterJobStateSchema = z.enum(["queued", "printing", "finished"]);

type PrinterJobState = z.infer<typeof PrinterJobStateSchema>;
```

✅ **Do** define domain values as owned runtime data, then derive every representation from them:

```ts
import { z } from "zod";

/* OK: implementation details derive from the owned domain values */
const PRINTER_JOB_STATES = ["queued", "printing", "finished"] as const;

type PrinterJobState = (typeof PRINTER_JOB_STATES)[number];

const PrinterJobStateSchema = z.enum(PRINTER_JOB_STATES);
```

**Allowed exception:** When an external contract is the true source of truth, treat it as boundary data and convert it into local domain values before the rest of the app depends on it.

❔ **Why:** Dependency inversion applies to domain values too. The module that owns a domain concept should own its canonical runtime values, while derived representations should depend on that source. Types, validators, UI options, serializers, adapters, and tests can all be generated or checked from the same values. That keeps domain behavior tied to the domain model instead of making the domain depend on implementation details.
