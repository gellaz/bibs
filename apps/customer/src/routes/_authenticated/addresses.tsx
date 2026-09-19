import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { MapPinPlus, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Notice } from "@/components/notice";
import { AddressCard } from "@/features/addresses/address-card";
import { AddressFormDialog } from "@/features/addresses/address-form-dialog";
import { useAddressMutations } from "@/features/addresses/use-address-mutations";
import type { AddressItem } from "@/features/addresses/use-addresses";
import { useAddresses } from "@/features/addresses/use-addresses";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/addresses")({
	component: AddressesPage,
});

function AddressesPage() {
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

	return (
		<div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="space-y-1">
					<h1 className="font-bold font-display text-2xl text-primary tracking-[-0.015em]">
						{m.addresses_title()}
					</h1>
					<p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
						{m.addresses_subtitle()}
					</p>
				</div>
				<Button className="min-h-11" onClick={openCreate}>
					<Plus className="size-4" aria-hidden />
					{m.addresses_add()}
				</Button>
			</div>

			<div className="mt-8">
				{isPending ? (
					<div className="space-y-3" aria-hidden>
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
				) : addresses && addresses.length > 0 ? (
					<ul className="space-y-3">
						{addresses.map((address) => (
							<AddressCard
								key={address.id}
								address={address}
								busy={remove.isPending}
								onEdit={() => openEdit(address)}
								onDelete={() => remove.mutate(address.id)}
							/>
						))}
					</ul>
				) : (
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
				)}
			</div>

			<AddressFormDialog
				key={editing?.id ?? "new"}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				address={editing}
			/>
		</div>
	);
}
