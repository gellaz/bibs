import { getContext } from "@bibs/ui/integrations/tanstack-query/root-provider";
import { intlLocaleFor, setIntlLocaleResolver } from "@bibs/ui/lib/intl-locale";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { getLocale } from "./paraglide/runtime";
import { routeTree } from "./routeTree.gen";

// I formatter di @bibs/ui seguono la lingua Paraglide di questa app.
setIntlLocaleResolver(() => intlLocaleFor(getLocale()));

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		context: getContext(),
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
