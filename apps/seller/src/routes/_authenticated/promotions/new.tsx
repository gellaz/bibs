import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/promotions/new")({
	component: NewPromotionPage,
});

function NewPromotionPage() {
	return <div>Nuova promozione (placeholder)</div>;
}
