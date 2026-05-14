import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/promotions/$discountId")({
	component: PromotionDetailPage,
});

function PromotionDetailPage() {
	const { discountId } = Route.useParams();
	return <div>Dettaglio promozione {discountId} (placeholder)</div>;
}
