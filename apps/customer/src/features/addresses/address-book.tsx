import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { MapPinPlus, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Notice } from "@/components/notice";
import { m } from "@/paraglide/messages";
import { AddressCard } from "./address-card";
import { AddressFormDialog } from "./address-form-dialog";
import { useAddressMutations } from "./use-address-mutations";
import type { AddressItem } from "./use-addresses";
import { useAddresses } from "./use-addresses";

/**
 * Rubrica indirizzi, sezione del profilo. `id="addresses"` è l'àncora del
 * «Gestisci indirizzi» nel selettore di origine della ricerca.
 */
export function AddressBook() {
	const { data: addresses, isPending, isError, refetch } = useAddresses();
	const { remove } = useAddressMutations();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<AddressItem | undefined>(undefined);

	const openCreate = () => {
		setEditing(undefined);
		setDialogOpen(true);
	};
	const openEdit = (address: AddressItem) => {
		setEditing(address);
		setDialogOpen(true);
	};

	// The empty state below has its own "add address" call to action; showing
	// the header one too would put two identical invites a few pixels apart.
	// Single source of truth for both the header button and which panel to
	// render below, so they can't drift apart if one of them changes later.
	// Keep the header button for every other state (loading, error, non-empty
	// list) so the user is never left without a way to add an address.
	const showEmptyState =
		!isPending && !isError && (!addresses || addresses.length === 0);

	return (
		<section id="addresses" className="mt-10 scroll-mt-24 sm:mt-12">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="space-y-1">
					<h2 className="font-semibold text-foreground text-xl tracking-[-0.005em]">
						{m.addresses_title()}
					</h2>
					<p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
						{m.addresses_subtitle()}
					</p>
				</div>
				{!showEmptyState && (
					<Button className="min-h-11 sm:min-h-9" onClick={openCreate}>
						<Plus className="size-4" aria-hidden />
						{m.addresses_add()}
					</Button>
				)}
			</div>

			<div className="mt-4">
				{isPending ? (
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
						<Skeleton className="h-32 w-full" />
						<Skeleton className="h-32 w-full" />
					</div>
				) : isError ? (
					<Notice
						icon={TriangleAlert}
						title={m.addresses_error_title()}
						description={m.addresses_error_description()}
						action={
							<Button
								variant="secondary"
								className="min-h-11 sm:min-h-9"
								onClick={() => refetch()}
							>
								{m.addresses_retry()}
							</Button>
						}
					/>
				) : showEmptyState ? (
					<Notice
						icon={MapPinPlus}
						title={m.addresses_empty_title()}
						description={m.addresses_empty_description()}
						action={
							<Button className="min-h-11 sm:min-h-9" onClick={openCreate}>
								<Plus className="size-4" aria-hidden />
								{m.addresses_add()}
							</Button>
						}
					/>
				) : (
					<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{(addresses ?? []).map((address) => (
							<AddressCard
								key={address.id}
								address={address}
								busy={remove.isPending}
								onEdit={() => openEdit(address)}
								onDelete={() => remove.mutate(address.id)}
							/>
						))}
					</ul>
				)}
			</div>

			<AddressFormDialog
				key={editing?.id ?? "new"}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				address={editing}
			/>
		</section>
	);
}
