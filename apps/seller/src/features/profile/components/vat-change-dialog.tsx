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
import { m } from "@/paraglide/messages";

export function VatChangeDialog({ currentVat }: { currentVat: string }) {
	const [open, setOpen] = useState(false);
	const [vat, setVat] = useState("");
	const [error, setError] = useState("");
	const qc = useQueryClient();

	const mut = useMutation({
		mutationFn: async () => {
			const r = await api().seller.settings.vat.patch({ vatNumber: vat });
			return unwrap(r, m.profile_vat_request_error());
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["seller", "settings"] });
			toast.success(m.profile_vat_request_sent());
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
				<Button variant="outline">{m.profile_vat_request_change()}</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.profile_vat_title()}</DialogTitle>
					<DialogDescription>{m.profile_vat_description()}</DialogDescription>
				</DialogHeader>
				<div className="grid gap-3">
					<div className="grid gap-1.5">
						<Label>{m.profile_vat_current()}</Label>
						<Input disabled value={currentVat} />
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="newVat">{m.profile_vat_new()}</Label>
						<Input
							id="newVat"
							value={vat}
							onChange={(e) => setVat(e.target.value)}
							placeholder={m.profile_vat_placeholder()}
							pattern="\d{11}"
						/>
					</div>
					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="ghost">{m.common_cancel()}</Button>
					</DialogClose>
					<Button
						onClick={() => {
							setError("");
							mut.mutate();
						}}
						disabled={!/^\d{11}$/.test(vat) || mut.isPending}
					>
						{mut.isPending ? m.profile_vat_sending() : m.profile_vat_submit()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
