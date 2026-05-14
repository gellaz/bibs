import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/promotions/")({
	component: PromotionsListPage,
	validateSearch: (search: Record<string, unknown>) => {
		const validStates = [
			"all",
			"running",
			"scheduled",
			"paused",
			"expired",
			"archived",
		] as const;
		type State = (typeof validStates)[number];
		const s = search.state;
		const state: State = validStates.includes(s as State)
			? (s as State)
			: "all";
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
			state,
		};
	},
});

function PromotionsListPage() {
	return <div>Lista promozioni (placeholder)</div>;
}
