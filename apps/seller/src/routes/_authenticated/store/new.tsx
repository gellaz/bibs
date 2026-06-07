import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import {
	StoreForm,
	type StoreFormData,
} from "@/features/stores/components/store-form";
import { useIsOwner } from "@/hooks/use-is-owner";
import { municipalitiesQueryOptions } from "@/hooks/use-municipalities";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/store/new")({
	validateSearch: (search) =>
		({
			cancel: typeof search.cancel === "string" ? search.cancel : undefined,
		}) as { cancel?: string },
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(municipalitiesQueryOptions()),
	component: NewStorePage,
});

function NewStorePage() {
	const navigate = useNavigate();
	const isOwner = useIsOwner();
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);
	const { cancel: pendingId } = Route.useSearch();
	const [prefillData, setPrefillData] = useState<Partial<StoreFormData> | null>(
		null,
	);
	const [prefillLoading, setPrefillLoading] = useState(!!pendingId);

	// Solo il titolare crea negozi. Guard client-side (NON in beforeLoad): lì
	// authClient.getSession() durante l'SSR non ha i cookie della request, la
	// sessione risulterebbe sempre null e il redirect romperebbe ogni full-page
	// load — inclusa la cancel_url di Stripe (/store/new?cancel=...). Il layout
	// _authenticated gata il render finché la sessione non è caricata, quindi
	// qui isOwner è già definitivo.
	useEffect(() => {
		if (!isOwner) void navigate({ to: "/store" });
	}, [isOwner, navigate]);

	useEffect(() => {
		if (!pendingId) return;
		void api()
			.seller.stores.checkout({ pendingId })
			.get()
			.then((res) => {
				const formData = res.data?.data?.formData;
				if (formData) {
					setPrefillData(formData as Partial<StoreFormData>);
				} else {
					// pendingId scaduto/sconosciuto: il form parte vuoto, ma va detto.
					toast.warning(m["store.new.prefill_error"]());
				}
			})
			.catch(() => toast.warning(m["store.new.prefill_error"]()))
			.finally(() => setPrefillLoading(false));
	}, [pendingId]);

	const createMutation = useMutation({
		mutationFn: async (formData: StoreFormData) => {
			const response = await api().seller.stores.checkout.post(formData);
			if (response.error) {
				throw new Error(
					response.error.value?.message || m["store.new.checkout_error"](),
				);
			}
			return response.data;
		},
		onSuccess: (data) => {
			if (data?.data?.checkoutUrl) {
				window.location.href = data.data.checkoutUrl;
			}
		},
		onError: (error: Error) =>
			toast.error(error.message || m["store.new.generic_error"]()),
	});

	if (!isOwner) {
		return null;
	}

	if (prefillLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<EntityFormHeader
				mode="create"
				title={name}
				placeholder="Nuovo Negozio"
				subtitle="Aggiungi un nuovo punto vendita"
			/>

			<StoreForm
				onSubmit={(data) => createMutation.mutate(data)}
				onCancel={() => void navigate({ to: "/store" })}
				isPending={createMutation.isPending}
				onNameChange={handleNameChange}
				defaultValues={prefillData ?? undefined}
				submitLabel={m["store.new.continue_to_payment"]()}
				pendingLabel={m["store.new.continue_to_payment"]()}
			/>
		</div>
	);
}
