import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import {
	Dialog,
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
import { Spinner } from "@bibs/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/billing/pricing")({
	component: PricingPage,
});

function PricingPage() {
	const qc = useQueryClient();
	const { data: current, isLoading } = useQuery({
		queryKey: ["admin", "billing", "pricing", "current"],
		queryFn: async () => {
			const r = await api().admin.billing.pricing.current.get();
			if (r.error) throw new Error(r.error.value?.message);
			return r.data?.data;
		},
	});

	const [open, setOpen] = useState(false);
	const [fee, setFee] = useState(0);
	const [days, setDays] = useState(60);
	const [hours, setHours] = useState(24);
	const [productId, setProductId] = useState("");

	const mutation = useMutation({
		mutationFn: async () => {
			const r = await api().admin.billing.pricing.put({
				storeMonthlyFeeCents: Math.round(fee * 100),
				currency: "EUR",
				suspendedAutoCancelDays: days,
				pendingCreationExpiryHours: hours,
				productId,
			});
			if (r.error) throw new Error(r.error.value?.message);
			return r.data?.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["admin", "billing"] });
			toast.success("Pricing aggiornato");
			setOpen(false);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (isLoading || !current) return <Spinner />;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Pricing corrente</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<p>
					<strong>Quota mensile:</strong> €
					{(current.storeMonthlyFeeCents / 100).toFixed(2)} {current.currency}
				</p>
				<p>
					<strong>Auto-cancel sospensione:</strong>{" "}
					{current.suspendedAutoCancelDays} giorni
				</p>
				<p>
					<strong>Expiry checkout pendente:</strong>{" "}
					{current.pendingCreationExpiryHours} ore
				</p>
				<p className="text-muted-foreground text-xs">
					Stripe Price ID: {current.stripePriceId}
				</p>

				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>
						<Button
							className="mt-4 self-start"
							onClick={() => {
								setFee(current.storeMonthlyFeeCents / 100);
								setDays(current.suspendedAutoCancelDays);
								setHours(current.pendingCreationExpiryHours);
							}}
						>
							Modifica
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Modifica pricing</DialogTitle>
							<DialogDescription>
								Crea un nuovo Stripe Price. Le subscription esistenti restano
								sul prezzo precedente.
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-3">
							<Label>Quota mensile (€)</Label>
							<Input
								type="number"
								step="0.01"
								value={fee}
								onChange={(e) => setFee(Number.parseFloat(e.target.value))}
							/>
							<Label>Auto-cancel dopo (giorni)</Label>
							<Input
								type="number"
								value={days}
								onChange={(e) => setDays(Number.parseInt(e.target.value, 10))}
							/>
							<Label>Expiry pending checkout (ore)</Label>
							<Input
								type="number"
								value={hours}
								onChange={(e) => setHours(Number.parseInt(e.target.value, 10))}
							/>
							<Label>Stripe Product ID</Label>
							<Input
								value={productId}
								onChange={(e) => setProductId(e.target.value)}
								placeholder="prod_..."
							/>
						</div>
						<DialogFooter>
							<Button
								onClick={() => mutation.mutate()}
								disabled={mutation.isPending}
							>
								Conferma
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</CardContent>
		</Card>
	);
}
