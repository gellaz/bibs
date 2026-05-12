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
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { cn } from "@bibs/ui/lib/utils";
import { CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
	useEmployeeStores,
	useUpdateEmployeeStores,
} from "@/hooks/use-employee-stores";
import { useStores } from "@/hooks/use-stores";

interface Props {
	employeeId: string;
	employeeName: string;
	trigger?: React.ReactNode;
	open?: boolean;
	onOpenChange?: (v: boolean) => void;
}

export function EmployeeStoresDialog({
	employeeId,
	employeeName,
	trigger,
	open: controlledOpen,
	onOpenChange,
}: Props) {
	const [internalOpen, setInternalOpen] = useState(false);
	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;
	const setOpen = (next: boolean) => {
		if (isControlled) onOpenChange?.(next);
		else setInternalOpen(next);
	};

	const { data: allStores } = useStores();
	const { data: assigned, isLoading } = useEmployeeStores(
		open ? employeeId : null,
	);
	const update = useUpdateEmployeeStores(employeeId);
	const [selected, setSelected] = useState<Set<string>>(new Set());

	useEffect(() => {
		if (assigned) setSelected(new Set(assigned.map((s) => s.id)));
	}, [assigned]);

	function toggle(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

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
			{trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
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
					<div className="flex max-h-72 flex-col gap-1 overflow-auto py-1">
						{(allStores ?? []).map((s) => {
							const isSelected = selected.has(s.id);
							return (
								<button
									key={s.id}
									type="button"
									onClick={() => toggle(s.id)}
									aria-pressed={isSelected}
									className={cn(
										"flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
										isSelected
											? "border-primary bg-primary/10 dark:bg-primary/15"
											: "border-transparent hover:bg-accent/50",
									)}
								>
									<span
										aria-hidden="true"
										className={cn(
											"flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
											isSelected
												? "border-primary bg-primary text-primary-foreground"
												: "border-border bg-card",
										)}
									>
										{isSelected && (
											<CheckIcon className="size-3.5" strokeWidth={3} />
										)}
									</span>
									<div className="flex min-w-0 flex-1 flex-col leading-tight">
										<span className="truncate text-sm font-medium">
											{s.name}
										</span>
										{s.city && (
											<span className="truncate text-muted-foreground text-xs">
												{s.city}
												{s.province ? `, ${s.province}` : ""}
											</span>
										)}
									</div>
								</button>
							);
						})}
					</div>
				)}
				{!isLoading && selected.size === 0 && (
					<p className="px-2 text-destructive text-xs">
						Seleziona almeno un negozio per salvare. Se vuoi rimuovere tutte le
						assegnazioni, usa l&apos;azione &quot;Rimuovi&quot; dal menu del
						dipendente.
					</p>
				)}
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="ghost">Annulla</Button>
					</DialogClose>
					<Button
						onClick={submit}
						disabled={update.isPending || selected.size === 0}
					>
						{update.isPending ? "Salvataggio…" : "Salva"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
