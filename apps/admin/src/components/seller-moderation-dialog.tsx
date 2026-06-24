import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";

export interface ModerationTarget {
	type: "verify" | "reject";
	sellerId: string;
	/** Pre-resolved display name: organization?.businessName ?? user.name */
	sellerName: string;
}

/**
 * Owns the verify/reject mutations + confirm-dialog target state shared by the
 * sellers list and the seller detail page. Pass `extraInvalidateKey` to also
 * invalidate a page-specific query (the detail page passes its detail key).
 */
export function useSellerModeration(opts?: {
	extraInvalidateKey?: readonly unknown[];
}) {
	const queryClient = useQueryClient();
	const [target, setTarget] = useState<ModerationTarget | null>(null);

	const invalidateLists = () => {
		if (opts?.extraInvalidateKey) {
			void queryClient.invalidateQueries({ queryKey: opts.extraInvalidateKey });
		}
		void queryClient.invalidateQueries({ queryKey: ["admin-sellers"] });
		void queryClient.invalidateQueries({ queryKey: ["admin-sellers-counts"] });
	};

	const verifyMutation = useMutation({
		mutationFn: async (sellerId: string) => {
			const response = await api().admin.sellers({ sellerId }).verify.patch();
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nella verifica",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateLists();
			setTarget(null);
			toast.success("Venditore approvato con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'approvazione");
		},
	});

	const rejectMutation = useMutation({
		mutationFn: async (sellerId: string) => {
			const response = await api().admin.sellers({ sellerId }).reject.patch();
			if (response.error) {
				throw new Error(response.error.value?.message || "Errore nel rifiuto");
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateLists();
			setTarget(null);
			toast.success("Venditore rifiutato");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante il rifiuto");
		},
	});

	const confirm = () => {
		if (!target) return;
		const mutation = target.type === "verify" ? verifyMutation : rejectMutation;
		mutation.mutate(target.sellerId);
	};

	return {
		target,
		setTarget,
		confirm,
		isPending: verifyMutation.isPending || rejectMutation.isPending,
	};
}

export function SellerModerationDialog({
	target,
	onOpenChange,
	onConfirm,
	isPending,
}: {
	target: ModerationTarget | null;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	isPending: boolean;
}) {
	const isVerify = target?.type === "verify";
	return (
		<AlertDialog open={!!target} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{isVerify ? "Approva venditore" : "Rifiuta venditore"}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{isVerify ? (
							<>
								Sei sicuro di voler approvare{" "}
								<strong>{target?.sellerName}</strong>? Il venditore potrà
								iniziare a operare sulla piattaforma.
							</>
						) : (
							<>
								Sei sicuro di voler rifiutare{" "}
								<strong>{target?.sellerName}</strong>? Il venditore dovrà
								aggiornare i dati e ripresentare la richiesta.
							</>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>Annulla</AlertDialogCancel>
					<AlertDialogAction
						variant={isVerify ? "success" : "destructive"}
						onClick={onConfirm}
						disabled={isPending}
					>
						{isPending ? "Attendere..." : isVerify ? "Approva" : "Rifiuta"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
