import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import {
	StoreForm,
	type StoreFormData,
} from "@/features/stores/components/store-form";
import { useActiveStore } from "@/hooks/use-active-store";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/store/new")({
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
	const queryClient = useQueryClient();
	const { setActiveStoreId } = useActiveStore();
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);

	const createMutation = useMutation({
		mutationFn: async (formData: StoreFormData) => {
			const response = await api().seller.stores.post(formData);
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nella creazione",
				);
			}
			return response.data;
		},
		onSuccess: (data) => {
			void queryClient.invalidateQueries({ queryKey: ["stores"] });
			toast.success("Negozio creato con successo");
			if (data?.data?.id) {
				setActiveStoreId(data.data.id);
			}
			void navigate({ to: "/" });
		},
		onError: (error: Error) =>
			toast.error(error.message || "Errore durante la creazione"),
	});

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
			/>
		</div>
	);
}
