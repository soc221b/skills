# Validating Boundary Data

**Rule:** Validate untrusted data where it enters the process. After parsing, pass validated domain values through internal code.

**Read when:** Code casts data from HTTP responses, `JSON.parse`, environment variables, storage, messages, sockets, files, or CLI input into a domain type.

❌ **Don't** cast or assert external data into domain types without validation:

```ts
/* WRONG: trusts network data blindly */
const USER_ROLES = ["admin", "member", "guest"] as const;
type UserRole = (typeof USER_ROLES)[number];
type User = {
  id: string;
  role: UserRole;
};

declare const response: Response;
const user = (await response.json()) as User;
```

✅ **Do** parse and validate boundary data with Zod or an equivalent schema library:

```ts
/* OK: schema validation proves the runtime shape */
import { z } from "zod";

const USER_ROLES = ["admin", "member", "guest"] as const;
type UserRole = (typeof USER_ROLES)[number];
type User = {
  id: string;
  role: UserRole;
};

const UserSchema: z.ZodType<User> = z.object({
  id: z.string().uuid(),
  role: z.enum(USER_ROLES),
});

declare const response: Response;
const user = UserSchema.parse(await response.json());
```

**Allowed exception:** Do not add schema validation for values already produced by trusted internal code or already validated at an earlier boundary.

❔ **Why:** TypeScript's type system is erased at runtime, so assertions cannot protect code from malformed data entering the process. HTTP responses, `JSON.parse` output, environment variables, `localStorage`, `postMessage`, WebSocket frames, and CLI arguments are common examples, not an exhaustive list. Define finite runtime sets as literal values, derive their types from those values, validate boundary data where it enters the process, and check object schemas against the domain type with the schema library the project already has.
