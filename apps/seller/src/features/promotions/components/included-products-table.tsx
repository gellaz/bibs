import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import { DiscountedPrice } from "@bibs/ui/components/discounted-price";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { useState } from "react";
import { m } from "@/paraglide/messages";

interface Row {
	id: string;
	name: string;
	originalPrice: string;
	discountedPrice: string;
}

interface Props {
	rows: Row[];
	percent: number;
	onRemove: (productIds: string[]) => void;
}

export function IncludedProductsTable({ rows, percent, onRemove }: Props) {
	const [selected, setSelected] = useState<Set<string>>(new Set());

	function toggleOne(id: string) {
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(id)) n.delete(id);
			else n.add(id);
			return n;
		});
	}

	return (
		<div className="space-y-2">
			{selected.size > 0 && (
				<Button
					variant="destructive"
					size="sm"
					onClick={() => {
						onRemove(Array.from(selected));
						setSelected(new Set());
					}}
				>
					{m.promotions_included_remove_bulk()}
				</Button>
			)}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-10" />
						<TableHead>Nome</TableHead>
						<TableHead>Prezzo</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((r) => (
						<TableRow key={r.id}>
							<TableCell>
								<Checkbox
									checked={selected.has(r.id)}
									onCheckedChange={() => toggleOne(r.id)}
								/>
							</TableCell>
							<TableCell>{r.name}</TableCell>
							<TableCell>
								<DiscountedPrice
									originalPrice={r.originalPrice}
									discountedPrice={r.discountedPrice}
									percent={percent}
									size="sm"
								/>
							</TableCell>
							<TableCell className="text-right">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => onRemove([r.id])}
								>
									{m.promotions_included_remove()}
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
