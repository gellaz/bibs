import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PencilIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	StoreForm,
	type StoreFormData,
} from "@/features/stores/components/store-form";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/stores/$storeId/edit")({
	component: EditStorePage,
});

function EditStorePage() {
	const { storeId } = Route.useParams();
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();

	// Employees cannot edit stores
	useEffect(() => {
		if (session && session.user.role !== "seller") {
			void navigate({ to: "/stores", search: { page: 1, limit: 20 } });
		}
	}, [session, navigate]);
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);

	const goBack = () =>
		void navigate({ to: "/stores", search: { page: 1, limit: 20 } });

	const {
		data: store,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["store", storeId],
		queryFn: async () => {
			const response = await api().seller.stores.get({
				query: { page: 1, limit: 100 },
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento negozio",
				);
			}

			const found = response.data.data.find((s) => s.id === storeId);
			if (!found) throw new Error("Negozio non trovato");
			return found;
		},
	});

	const updateMutation = useMutation({
		mutationFn: async (formData: StoreFormData) => {
			const response = await api().seller.stores({ storeId }).patch(formData);

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nell'aggiornamento",
				);
			}

			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["stores"] });
			void queryClient.invalidateQueries({ queryKey: ["store", storeId] });
			toast.success("Negozio aggiornato con successo");
			goBack();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'aggiornamento");
		},
	});

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if (error || !store) {
		return (
			<div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-4">
				<p className="text-sm">
					{(error as Error)?.message || "Negozio non trovato"}
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">
						{name || (
							<span className="text-muted-foreground">Modifica Negozio</span>
						)}
					</h1>
					<p className="text-muted-foreground text-sm">
						Modifica punto vendita
					</p>
				</div>
				<div className="bg-primary flex size-10 items-center justify-center rounded-lg">
					<PencilIcon className="text-primary-foreground size-5" />
				</div>
			</div>

			<StoreForm
				defaultValues={{
					name: store.name,
					description: store.description ?? "",
					addressLine1: store.addressLine1,
					addressLine2: store.addressLine2 ?? "",
					city: store.city,
					zipCode: store.zipCode,
					province: store.province ?? "",
					websiteUrl: store.websiteUrl ?? "",
					phoneNumbers: store.phoneNumbers.map((p) => ({
						label: p.label ?? "",
						number: p.number,
						position: p.position,
					})),
				}}
				onSubmit={(data) => updateMutation.mutate(data)}
				onCancel={goBack}
				isPending={updateMutation.isPending}
				submitLabel="Salva Modifiche"
				pendingLabel="Salvataggio..."
				onNameChange={handleNameChange}
			/>
		</div>
	);
}
