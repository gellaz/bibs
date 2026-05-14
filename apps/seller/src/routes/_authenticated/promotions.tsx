import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/promotions")({
	component: PromotionsLayout,
});

function PromotionsLayout() {
	return <Outlet />;
}
