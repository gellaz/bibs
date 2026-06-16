import { Button } from "@bibs/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	ArchiveIcon,
	MoreHorizontalIcon,
	PauseIcon,
	PlayIcon,
} from "lucide-react";
import { useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import { SectionHeader } from "@/components/section-header";
import { DiscountForm } from "@/features/promotions/components/discount-form";
import { ProductSelector } from "@/features/promotions/components/product-selector";
import { PromotionStateBadge } from "@/features/promotions/components/promotion-state-badge";
import {
	useArchiveDiscount,
	useDiscount,
	usePauseDiscount,
	useUpdateDiscount,
} from "@/features/promotions/hooks/use-discounts";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/promotions/$discountId")({
	component: PromotionDetailPage,
});

function PromotionDetailPage() {
	const { discountId } = Route.useParams();
	const navigate = useNavigate();
	const detail = useDiscount(discountId);
	const update = useUpdateDiscount(discountId);
	const pause = usePauseDiscount();
	const archive = useArchiveDiscount();
	const [title, setTitle] = useState<string | undefined>(undefined);

	if (detail.isLoading) return <Spinner />;
	if (!detail.data) return <div>Promozione non trovata</div>;

	const d = detail.data.data;
	const isStarted = new Date(d.startsAt).getTime() <= Date.now();
	const isActive = d.status !== "archived";

	return (
		<div className="-m-4 xl:flex xl:h-full xl:flex-col">
			<div className="grid xl:flex-1 xl:grid-cols-[2fr_3fr] xl:gap-x-0">
				<div className="space-y-6 p-4 pb-6 xl:p-6">
					<EntityFormHeader
						mode="edit"
						title={title ?? d.title}
						placeholder="Modifica Promozione"
						subtitle="Aggiorna i dettagli della promozione"
						badge={
							<PromotionStateBadge
								status={d.status}
								startsAt={d.startsAt}
								endsAt={d.endsAt}
							/>
						}
						menu={
							isActive ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="size-10"
											aria-label="Altre azioni"
										>
											<MoreHorizontalIcon className="size-5" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-48">
										<DropdownMenuItem
											onSelect={() =>
												pause.mutate(discountId, {
													onSuccess: () =>
														toast.success(
															d.status === "paused"
																? m.promotions_toast_resumed()
																: m.promotions_toast_paused(),
														),
												})
											}
										>
											{d.status === "paused" ? <PlayIcon /> : <PauseIcon />}
											<span>
												{d.status === "paused"
													? m.promotions_action_resume()
													: m.promotions_action_pause()}
											</span>
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											className="text-destructive focus:text-destructive focus:bg-destructive/10"
											onSelect={() =>
												archive.mutate(discountId, {
													onSuccess: () =>
														toast.success(m.promotions_toast_archived()),
												})
											}
										>
											<ArchiveIcon />
											<span>{m.promotions_action_archive()}</span>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							) : null
						}
					/>

					<DiscountForm
						defaultValues={{
							title: d.title,
							percent: d.percent,
							startsAt: new Date(d.startsAt).toISOString().slice(0, 16),
							endsAt: d.endsAt
								? new Date(d.endsAt).toISOString().slice(0, 16)
								: "",
							noEndDate: !d.endsAt,
						}}
						disablePercent={isStarted}
						disableStartsAt={isStarted}
						submitLabel={m.promotions_form_submit_edit()}
						submitting={update.isPending}
						onTitleChange={setTitle}
						onCancel={() =>
							void navigate({
								to: "/promotions",
								search: { page: 1, limit: 20, state: "assignable" as const },
							})
						}
						onSubmit={async (v) => {
							await update.mutateAsync({
								title: v.title,
								percent: isStarted ? undefined : v.percent,
								startsAt: isStarted ? undefined : new Date(v.startsAt),
								endsAt: v.noEndDate || !v.endsAt ? null : new Date(v.endsAt),
							});
							toast.success(m.promotions_toast_updated());
						}}
					/>
				</div>

				<section className="space-y-6 border-t p-4 pt-6 xl:border-t-0 xl:border-l xl:p-6">
					<SectionHeader
						title={m.promotions_section_products_title()}
						subtitle={m.promotions_section_products_subtitle()}
					/>
					<ProductSelector
						mode={{ kind: "mutate", discountId, percent: d.percent }}
					/>
				</section>
			</div>
		</div>
	);
}
