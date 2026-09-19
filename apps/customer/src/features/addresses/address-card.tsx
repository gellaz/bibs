import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@bibs/ui/components/alert-dialog";
import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { m } from "@/paraglide/messages";
import type { AddressItem } from "./use-addresses";

interface AddressCardProps {
	address: AddressItem;
	onEdit: () => void;
	onDelete: () => void;
	busy?: boolean;
}

export function AddressCard({
	address,
	onEdit,
	onDelete,
	busy,
}: AddressCardProps) {
	const title = address.label?.trim() || address.addressLine1;

	return (
		<li className="rounded-xl border border-border p-4">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h3 className="truncate font-display font-semibold text-foreground">
							{title}
						</h3>
						{address.isDefault && (
							<Badge variant="secondary">{m.addresses_default_badge()}</Badge>
						)}
					</div>
					<p className="mt-1 text-muted-foreground text-sm">
						{address.addressLine1}
						{address.addressLine2 ? `, ${address.addressLine2}` : ""}
					</p>
					<p className="text-muted-foreground text-sm">
						{address.zipCode} {address.municipality.name} (
						{address.municipality.provinceAcronym})
					</p>
					{(address.recipientName || address.phone) && (
						<p className="mt-1 text-muted-foreground text-xs">
							{[address.recipientName, address.phone]
								.filter(Boolean)
								.join(" · ")}
						</p>
					)}
				</div>
			</div>

			<div className="mt-3 flex flex-wrap gap-2">
				<Button
					variant="secondary"
					size="sm"
					className="min-h-11 sm:min-h-9"
					onClick={onEdit}
					disabled={busy}
				>
					{m.addresses_edit()}
				</Button>
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="min-h-11 text-destructive sm:min-h-9"
							disabled={busy}
						>
							{m.addresses_delete()}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{m.addresses_delete_title()}</AlertDialogTitle>
							<AlertDialogDescription>
								{m.addresses_delete_description()}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel className="min-h-11 sm:min-h-9">
								{m.address_form_cancel()}
							</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								className="min-h-11 sm:min-h-9"
								onClick={onDelete}
							>
								{m.addresses_delete_confirm()}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</li>
	);
}
