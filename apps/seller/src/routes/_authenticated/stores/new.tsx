import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";
import {
	StoreForm,
	type StoreFormData,
} from "@/features/stores/components/store-form";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/stores/new")({
	component: NewStorePage,
});

function NewStorePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);

	const goBack = () =>
		void navigate({ to: "/stores", search: { page: 1, limit: 20 } });

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
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["stores"] });
			toast.success("Negozio creato con successo");
			goBack();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">
						{name || (
							<span className="text-muted-foreground">Nuovo Negozio</span>
						)}
					</h1>
					<p className="text-muted-foreground text-sm">
						Aggiungi un nuovo punto vendita
					</p>
				</div>
				<div className="bg-primary flex size-10 items-center justify-center rounded-lg">
					<PlusIcon className="text-primary-foreground size-5" />
				</div>
			</div>

			<StoreForm
				onSubmit={(data) => createMutation.mutate(data)}
				onCancel={goBack}
				isPending={createMutation.isPending}
				onNameChange={handleNameChange}
			/>
		</div>
	);
}
