import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useStores } from "@/hooks/use-stores";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface Props {
	productId: string;
	assignedStoreIds: string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: () => void;
}

export function StoreAssignmentDialog({
	productId,
	assignedStoreIds,
	open,
	onOpenChange,
	onSuccess,
}: Props) {
	const queryClient = useQueryClient();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [initialStock, setInitialStock] = useState("0");

	const { data: stores } = useStores();

	const available = (stores ?? []).filter(
		(s) => !assignedStoreIds.includes(s.id),
	);

	const assignMutation = useMutation({
		mutationFn: async () => {
			const stock = Number.parseInt(initialStock, 10);
			const response = await api()
				.seller.products({ productId })
				.stores.post({
					storeIds: Array.from(selected),
					stock: Number.isNaN(stock) ? 0 : stock,
				});
			if (response.error) throw new Error("Errore assegnazione");
			return response.data.data;
		},
		onSuccess: (data) => {
			void queryClient.invalidateQueries({ queryKey: ["product", productId] });
			void queryClient.invalidateQueries({ queryKey: ["products"] });
			toast.success(
				m.products_store_assignment_dialog_success({ count: data.length }),
			);
			onSuccess?.();
			onOpenChange(false);
			setSelected(new Set());
			setInitialStock("0");
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{m.products_store_assignment_dialog_title()}
					</DialogTitle>
				</DialogHeader>

				{available.length === 0 ? (
					<p className="text-muted-foreground py-4 text-sm">
						{m.products_store_assignment_dialog_all_covered()}
					</p>
				) : (
					<div className="space-y-4">
						<div className="space-y-1">
							{available.map((store) => (
								<label
									key={store.id}
									htmlFor={`store-${store.id}`}
									className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
								>
									<Checkbox
										id={`store-${store.id}`}
										checked={selected.has(store.id)}
										onCheckedChange={() => toggle(store.id)}
									/>
									<span className="text-sm">{store.name}</span>
									<span className="text-muted-foreground text-xs">
										— {store.city}
									</span>
								</label>
							))}
						</div>

						<div className="space-y-1">
							<Label htmlFor="initial-stock">
								{m.products_store_assignment_dialog_initial_stock()}
							</Label>
							<Input
								id="initial-stock"
								type="number"
								inputMode="numeric"
								min={0}
								value={initialStock}
								onChange={(e) => setInitialStock(e.target.value)}
								className="w-32"
							/>
						</div>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{m.common_cancel()}
					</Button>
					<Button
						onClick={() => assignMutation.mutate()}
						disabled={selected.size === 0 || assignMutation.isPending}
					>
						{m.common_confirm()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
