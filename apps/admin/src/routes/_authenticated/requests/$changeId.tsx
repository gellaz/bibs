import { createFileRoute } from "@tanstack/react-router";

// Segnaposto: la pagina di dettaglio arriva nel task successivo.
export const Route = createFileRoute("/_authenticated/requests/$changeId")({
	component: () => null,
});
