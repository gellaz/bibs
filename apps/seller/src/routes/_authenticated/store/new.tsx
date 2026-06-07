import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import { FormSection } from "@/components/form-section";
import {
	StoreForm,
	type StoreFormData,
} from "@/features/stores/components/store-form";
import { useIsOwner } from "@/hooks/use-is-owner";
import { municipalitiesQueryOptions } from "@/hooks/use-municipalities";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

/** Step del flusso di creazione mostrati nell'aside "Come funziona". */
const CHECKOUT_STEPS = [
	{
		title: "Compili i dati del negozio",
		detail: "Indirizzo, orari e contatti restano modificabili anche dopo.",
	},
	{
		title: "Attivi l'abbonamento",
		detail: "Canone mensile per punto vendita, pagamento gestito da Stripe.",
	},
	{
		title: "Il negozio è subito attivo",
		detail: "Puoi caricare da subito le foto vetrina e aggiungere i prodotti.",
	},
];

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
		// w-full obbligatorio: il wrapper è flex-item del layout e le FormSection
		// figlie sono @container (zero contributo intrinseco) — senza, mx-auto
		// va in shrink-to-fit e la pagina collassa a ~280px (vedi PR #84).
		<div className="mx-auto w-full max-w-7xl space-y-10">
			<EntityFormHeader
				mode="create"
				title={name}
				placeholder="Nuovo Negozio"
				subtitle="Aggiungi un nuovo punto vendita"
			/>

			<div className="@container">
				<div className="grid gap-x-10 gap-y-8 @2xl:grid-cols-[minmax(0,1fr)_18rem]">
					<div className="min-w-0">
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
					<div className="space-y-8">
						<FormSection
							title="Come funziona"
							description="Dalla compilazione all'apertura su bibs."
						>
							<ol className="space-y-4 text-sm">
								{CHECKOUT_STEPS.map((step, index) => (
									<li key={step.title} className="flex gap-3">
										<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-cobalt-soft text-[11px] font-semibold text-cobalt-deep">
											{index + 1}
										</span>
										<div>
											<p className="font-medium">{step.title}</p>
											<p className="text-muted-foreground">{step.detail}</p>
										</div>
									</li>
								))}
							</ol>
						</FormSection>
					</div>
				</div>
			</div>
		</div>
	);
}
