import type { App } from "@bibs/api";
import { createApiClient } from "@bibs/ui/lib/api-client";

export const api = createApiClient<App>(
	import.meta.env.VITE_API_URL || "http://localhost:3000",
);
