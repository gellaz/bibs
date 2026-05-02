import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
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
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useEffect, useState } from "react";
import {
	useEmployeeStores,
	useUpdateEmployeeStores,
} from "@/hooks/use-employee-stores";
import { useStores } from "@/hooks/use-stores";

interface Props {
	employeeId: string;
	employeeName: string;
	trigger: React.ReactNode;
}

export function EmployeeStoresDialog({
	employeeId,
	employeeName,
	trigger,
}: Props) {
	const [open, setOpen] = useState(false);
	const { data: allStores } = useStores();
	const { data: assigned, isLoading } = useEmployeeStores(
		open ? employeeId : null,
	);
	const update = useUpdateEmployeeStores(employeeId);
	const [selected, setSelected] = useState<Set<string>>(new Set());

	useEffect(() => {
		if (assigned) setSelected(new Set(assigned.map((s) => s.id)));
	}, [assigned]);

	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const submit = async () => {
		try {
			await update.mutateAsync(Array.from(selected));
			toast.success("Assegnazioni aggiornate");
			setOpen(false);
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Assegna negozi a {employeeName}</DialogTitle>
					<DialogDescription>
						Seleziona i negozi a cui {employeeName} ha accesso.
					</DialogDescription>
				</DialogHeader>
				{isLoading ? (
					<div className="flex justify-center py-4">
						<Spinner />
					</div>
				) : (
					<div className="flex flex-col gap-2 py-2 max-h-72 overflow-auto">
						{(allStores ?? []).map((s) => (
							<Label
								key={s.id}
								className="flex items-center gap-2 cursor-pointer rounded-md p-2 hover:bg-muted"
							>
								<Checkbox
									checked={selected.has(s.id)}
									onCheckedChange={() => toggle(s.id)}
								/>
								<span className="flex-1">
									{s.name}{" "}
									<span className="text-xs text-muted-foreground">
										({s.city}
										{s.province ? `, ${s.province}` : ""})
									</span>
								</span>
							</Label>
						))}
					</div>
				)}
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="ghost">Annulla</Button>
					</DialogClose>
					<Button onClick={submit} disabled={update.isPending}>
						{update.isPending ? "Salvataggio…" : "Salva"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
