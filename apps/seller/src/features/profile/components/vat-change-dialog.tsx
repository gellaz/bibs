import { Button } from "@bibs/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/lib/api";

export function VatChangeDialog({ currentVat }: { currentVat: string }) {
	const [open, setOpen] = useState(false);
	const [vat, setVat] = useState("");
	const [error, setError] = useState("");
	const qc = useQueryClient();

	const mut = useMutation({
		mutationFn: async () => {
			const r = await api().seller.settings.vat.patch({ vatNumber: vat });
			return unwrap(r, "Errore nella richiesta");
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["seller", "settings"] });
			toast.success("Richiesta inviata. Verrà rivista da un amministratore.");
			setOpen(false);
			setVat("");
			setError("");
		},
		onError: (e: Error) => setError(e.message),
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) {
					setVat("");
					setError("");
				}
				setOpen(o);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline">Richiedi cambio</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Richiedi cambio Partita IVA</DialogTitle>
					<DialogDescription>
						La modifica richiede l'approvazione di un amministratore. Durante la
						review non potrai ricevere nuovi ordini.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-3">
					<div className="grid gap-1.5">
						<Label>P.IVA attuale</Label>
						<Input disabled value={currentVat} />
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="newVat">Nuova P.IVA</Label>
						<Input
							id="newVat"
							value={vat}
							onChange={(e) => setVat(e.target.value)}
							placeholder="11 cifre"
							pattern="\d{11}"
						/>
					</div>
					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="ghost">Annulla</Button>
					</DialogClose>
					<Button
						onClick={() => {
							setError("");
							mut.mutate();
						}}
						disabled={!/^\d{11}$/.test(vat) || mut.isPending}
					>
						{mut.isPending ? "Invio…" : "Richiedi"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
