import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Browser: un solo QueryClient per la sessione (cache viva tra navigazioni).
// Server: un QueryClient NUOVO a ogni getContext() — cioè a ogni richiesta
// SSR, dato che getRouter() viene invocato per-request — così la cache
// (potenzialmente per-utente) non trapela mai tra richieste concorrenti.
let browserContext: { queryClient: QueryClient } | undefined;

export function getContext(): { queryClient: QueryClient } {
	if (typeof window === "undefined") {
		return { queryClient: new QueryClient() };
	}
	browserContext ??= { queryClient: new QueryClient() };
	return browserContext;
}

export default function TanStackQueryProvider({
	queryClient,
	children,
}: {
	queryClient: QueryClient;
	children: ReactNode;
}) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
