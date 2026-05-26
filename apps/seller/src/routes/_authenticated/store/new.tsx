import { toast } from "@bibs/ui/components/sonner";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import {
	StoreForm,
	type StoreFormData,
} from "@/features/stores/components/store-form";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/store/new")({
	validateSearch: (search) =>
		({
			cancel: typeof search.cancel === "string" ? search.cancel : undefined,
		}) as { cancel?: string },
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (session.data?.user.role !== "seller") {
			throw redirect({ to: "/store" });
		}
	},
	component: NewStorePage,
});

function NewStorePage() {
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);
	const { cancel: pendingId } = Route.useSearch();
	const [prefillData, setPrefillData] = useState<Partial<StoreFormData> | null>(
		null,
	);
	const [prefillLoading, setPrefillLoading] = useState(!!pendingId);

	useEffect(() => {
		if (!pendingId) return;
		void api()
			.seller.stores.checkout({ pendingId })
			.get()
			.then((res) => {
				if (res.data?.data?.formData) {
					setPrefillData(res.data.data.formData as Partial<StoreFormData>);
				}
			})
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

	if (prefillLoading) {
		return null;
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
