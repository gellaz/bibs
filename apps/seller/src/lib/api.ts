import type { App } from "@bibs/api";
import { createApiClient } from "@bibs/ui/lib/api-client";

export const api = createApiClient<App>(
	import.meta.env.VITE_API_URL || "http://localhost:3000",
);

// edenMessage/unwrap are generic Eden helpers shared from @bibs/ui; re-exported
// here so the seller's existing `@/lib/api` import sites keep working.
export { edenMessage, unwrap } from "@bibs/ui/lib/api-client";
