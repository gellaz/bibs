import { Button } from "@bibs/ui/components/button";
import { EmptyState } from "@bibs/ui/components/empty-state";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2Icon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { OrderStatusBadge } from "@/features/orders/components/order-status-badge";
import { PickupScanner } from "@/features/orders/components/pickup-scanner";
import {
	useConfirmPickup,
	usePickupPreview,
} from "@/features/orders/hooks/use-pickup";
import { ORDER_TYPE_LABEL, shortOrderId } from "@/features/orders/order-labels";
import {
	formatPickupCode,
	isCompletePickupCode,
	normalizePickupCode,
} from "@/features/orders/pickup-code";
import { useActiveStore } from "@/hooks/use-active-store";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/pickup")({
	component: PickupPage,
});

const toCents = (v: string) => Math.round(Number(v) * 100);

function PickupPage() {
	const { activeStore, isLoading: storeLoading } = useActiveStore();
	const storeId = activeStore?.id;
	const inputId = useId();
	const errorId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	// Codice normalizzato (maiuscolo, senza spazi): il campo lo mostra 3-3.
	const [code, setCode] = useState("");
	const [done, setDone] = useState<{ number: string; customer: string } | null>(
		null,
	);

	const preview = usePickupPreview(storeId, code);
	const confirm = useConfirmPickup();

	useEffect(() => {
		if (!done) inputRef.current?.focus();
	}, [done]);

	if (!activeStore && !storeLoading)
		return <EmptyState title={m.pickup_no_store()} />;

	const changeCode = (next: string) => {
		confirm.reset();
		setCode(normalizePickupCode(next).slice(0, 6));
	};

	const startOver = () => {
		confirm.reset();
		setCode("");
		setDone(null);
	};

	const order = preview.data;
	const error =
		confirm.error?.message ??
		(isCompletePickupCode(code) ? preview.error?.message : undefined) ??
		(code.length === 6 && !isCompletePickupCode(code)
			? m.pickup_not_found()
			: undefined);

	const onConfirm = () => {
		if (!storeId || !order) return;
		confirm.mutate(
			{ storeId, code },
			{
				onSuccess: () => {
					setDone({
						number: shortOrderId(order.id),
						customer: order.customerProfile.user.name,
					});
					setCode("");
				},
			},
		);
	};

	return (
		<div className="mx-auto w-full max-w-2xl space-y-6">
			<div>
				<h1 className="font-display font-semibold text-2xl tracking-tight">
					{m.pickup_title()}
				</h1>
				<p className="text-muted-foreground text-sm">{m.pickup_subtitle()}</p>
			</div>

			{done ? (
				<section className="flex flex-col items-center gap-4 rounded-xl border border-border p-8 text-center">
					<CheckCircle2Icon className="size-10 text-success" aria-hidden />
					<div className="space-y-1" role="status">
						<h2 className="font-display font-semibold text-foreground text-xl">
							{m.pickup_done()}
						</h2>
						<p className="text-muted-foreground text-sm">
							{m.pickup_done_description(done)}
						</p>
					</div>
					<Button type="button" size="lg" onClick={startOver}>
						{m.pickup_new()}
					</Button>
				</section>
			) : (
				<>
					<section className="space-y-4 rounded-xl border border-border p-4">
						<div className="space-y-2">
							<Label htmlFor={inputId}>{m.pickup_code_label()}</Label>
							<Input
								id={inputId}
								ref={inputRef}
								value={formatPickupCode(code)}
								onChange={(e) => changeCode(e.target.value)}
								placeholder={m.pickup_code_placeholder()}
								inputMode="text"
								autoCapitalize="characters"
								autoComplete="off"
								autoCorrect="off"
								spellCheck={false}
								aria-invalid={!!error}
								aria-describedby={error ? errorId : undefined}
								className="h-14 font-mono font-semibold text-2xl tracking-[0.2em] md:text-2xl"
							/>
							{error && (
								<p
									id={errorId}
									role="alert"
									className="text-destructive text-sm"
								>
									{error}
								</p>
							)}
						</div>
						<PickupScanner onCode={changeCode} />
					</section>

					{preview.isFetching && !order && (
						<div className="flex justify-center py-6">
							<Spinner />
						</div>
					)}

					{order && !preview.isError && (
						<section className="space-y-4 rounded-xl border border-border p-4">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="space-y-0.5">
									<p className="font-display font-semibold text-foreground text-lg tabular-nums">
										{shortOrderId(order.id)}
									</p>
									<p className="text-muted-foreground text-sm">
										{ORDER_TYPE_LABEL[order.type]()}
									</p>
								</div>
								<OrderStatusBadge status={order.status} />
							</div>

							<p className="text-sm">
								<span className="text-muted-foreground">
									{m.pickup_customer()}
								</span>{" "}
								<span className="font-medium text-foreground">
									{order.customerProfile.user.name}
								</span>
							</p>

							<ul className="divide-y divide-border border-border border-y">
								{order.items.map((item) => (
									<li
										key={item.id}
										className="flex justify-between gap-3 py-2 text-sm"
									>
										<span className="min-w-0 text-foreground">
											{item.quantity} × {item.productName}
										</span>
										<span className="shrink-0 tabular-nums">
											{formatPriceEur(
												(toCents(item.unitPrice) * item.quantity) / 100,
											)}
										</span>
									</li>
								))}
							</ul>

							<div className="flex items-baseline justify-between gap-3">
								<span className="text-muted-foreground text-sm">
									{order.type === "reserve_pickup"
										? m.orders_detail_to_collect()
										: m.orders_detail_paid_online()}
								</span>
								<span className="font-semibold text-foreground text-xl tabular-nums">
									{formatPriceEur(order.total)}
								</span>
							</div>

							<Button
								type="button"
								size="lg"
								className="w-full"
								onClick={onConfirm}
								disabled={confirm.isPending}
							>
								{confirm.isPending && <Spinner />}
								{m.pickup_confirm()}
							</Button>
						</section>
					)}
				</>
			)}
		</div>
	);
}
