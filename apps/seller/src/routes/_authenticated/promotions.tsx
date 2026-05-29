import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useIsOwner } from "@/hooks/use-is-owner";

export const Route = createFileRoute("/_authenticated/promotions")({
	component: PromotionsLayout,
});

function PromotionsLayout() {
	const navigate = useNavigate();
	const isOwner = useIsOwner();

	// Promotions are owner-only (the API enforces requireOwner on every discount
	// endpoint). Employees who deep-link here are redirected home.
	useEffect(() => {
		if (!isOwner) void navigate({ to: "/" });
	}, [isOwner, navigate]);

	if (!isOwner) return null;
	return <Outlet />;
}
