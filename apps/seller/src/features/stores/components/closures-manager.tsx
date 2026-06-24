// apps/seller/src/features/stores/components/closures-manager.tsx
import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Separator } from "@bibs/ui/components/separator";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface CustomClosure {
	startDate: string;
	endDate?: string;
	note?: string;
}

interface HolidayRow {
	definitionId: string;
	name: string;
	type: "fixed" | "easter_relative" | "one_off";
	nextDate: string | null;
	observed: boolean;
}

export interface ClosuresState {
	holidays: HolidayRow[];
	customClosures: CustomClosure[];
}

function serialize(optOutIds: string[], custom: CustomClosure[]): string {
	return JSON.stringify({
		opt: [...optOutIds].sort(),
		custom: [...custom]
			.map((c) => ({ s: c.startDate, e: c.endDate ?? null, n: c.note ?? "" }))
			.sort((a, b) => a.s.localeCompare(b.s)),
	});
}

function formatDate(ymd: string): string {
	const [y, m, d] = ymd.split("-").map(Number);
	return new Date(y, m - 1, d).toLocaleDateString("it-IT", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function ClosuresManager({
	storeId,
	initial,
}: {
	storeId: string;
	initial: ClosuresState;
}) {
	const queryClient = useQueryClient();

	const [optOutIds, setOptOutIds] = useState<string[]>(() =>
		initial.holidays.filter((h) => !h.observed).map((h) => h.definitionId),
	);
	const [customClosures, setCustomClosures] = useState<CustomClosure[]>(
		() => initial.customClosures,
	);

	const initialSerialized = useMemo(
		() =>
			serialize(
				initial.holidays.filter((h) => !h.observed).map((h) => h.definitionId),
				initial.customClosures,
			),
		[initial],
	);
	const dirty = serialize(optOutIds, customClosures) !== initialSerialized;

	const toggleObserved = (id: string) =>
		setOptOutIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);

	const updateClosure = (index: number, patch: Partial<CustomClosure>) =>
		setCustomClosures((prev) =>
			prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
		);

	const addClosure = () => {
		const today = new Intl.DateTimeFormat("en-CA", {
			timeZone: "Europe/Rome",
		}).format(new Date());
		setCustomClosures((prev) => [...prev, { startDate: today }]);
	};

	const removeClosure = (index: number) =>
		setCustomClosures((prev) => prev.filter((_, i) => i !== index));

	const mutation = useMutation({
		mutationFn: async () => {
			const cleaned = customClosures
				.filter((c) => c.startDate)
				.map((c) => ({
					startDate: c.startDate,
					endDate: c.endDate || undefined,
					note: c.note?.trim() ? c.note.trim() : undefined,
				}));
			const response = await api()
				.seller.stores({ storeId })
				.closures.put({ optOutIds, customClosures: cleaned });
			return unwrap(response, m["store.closures.error"]());
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["store-closures", storeId],
			});
			void queryClient.invalidateQueries({ queryKey: ["stores"] });
			toast.success(m["store.closures.saved"]());
		},
		onError: (e: Error) =>
			toast.error(e.message || m["store.closures.error"]()),
	});

	return (
		<div className="space-y-10">
			<section className="space-y-4">
				<header className="space-y-1.5">
					<h2 className="font-display text-base font-semibold tracking-tight">
						{m["store.closures.holidays_title"]()}
					</h2>
					<p className="text-sm leading-relaxed text-muted-foreground">
						{m["store.closures.holidays_hint"]()}
					</p>
				</header>
				<div className="overflow-hidden rounded-lg border border-border">
					<table className="w-full text-sm">
						<tbody className="divide-y divide-border">
							{initial.holidays.map((h) => {
								const observed = !optOutIds.includes(h.definitionId);
								return (
									<tr key={h.definitionId} className="bg-card">
										<td className="px-4 py-3 font-medium">{h.name}</td>
										<td className="px-4 py-3 text-muted-foreground">
											{h.nextDate
												? formatDate(h.nextDate)
												: m["store.closures.no_next"]()}
										</td>
										<td className="px-4 py-3 text-right">
											<Button
												type="button"
												variant={observed ? "secondary" : "outline"}
												size="sm"
												onClick={() => toggleObserved(h.definitionId)}
											>
												{observed
													? m["store.closures.closed"]()
													: m["store.closures.open"]()}
											</Button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</section>

			<Separator />

			<section className="space-y-4">
				<header className="space-y-1.5">
					<h2 className="font-display text-base font-semibold tracking-tight">
						{m["store.closures.custom_title"]()}
					</h2>
					<p className="text-sm leading-relaxed text-muted-foreground">
						{m["store.closures.custom_hint"]()}
					</p>
				</header>

				{customClosures.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{m["store.closures.empty_custom"]()}
					</p>
				) : (
					<div className="space-y-3">
						{customClosures.map((c, i) => (
							<div
								key={`${i}-${c.startDate}`}
								className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
							>
								<label
									htmlFor={`closure-start-${i}`}
									className="flex flex-col gap-1"
								>
									<span className="text-xs text-muted-foreground">
										{m["store.closures.start"]()}
									</span>
									<Input
										id={`closure-start-${i}`}
										type="date"
										value={c.startDate}
										onChange={(e) =>
											updateClosure(i, { startDate: e.target.value })
										}
									/>
								</label>
								<label
									htmlFor={`closure-end-${i}`}
									className="flex flex-col gap-1"
								>
									<span className="text-xs text-muted-foreground">
										{m["store.closures.end"]()}
									</span>
									<Input
										id={`closure-end-${i}`}
										type="date"
										value={c.endDate ?? ""}
										min={c.startDate}
										onChange={(e) =>
											updateClosure(i, { endDate: e.target.value || undefined })
										}
									/>
								</label>
								<Input
									className="min-w-[12rem] flex-1"
									placeholder={m["store.closures.note_ph"]()}
									value={c.note ?? ""}
									onChange={(e) => updateClosure(i, { note: e.target.value })}
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label={m["store.closures.remove"]()}
									onClick={() => removeClosure(i)}
								>
									<Trash2Icon className="size-4" />
								</Button>
							</div>
						))}
					</div>
				)}

				<Button type="button" variant="outline" onClick={addClosure}>
					<PlusIcon />
					<span>{m["store.closures.add"]()}</span>
				</Button>
			</section>

			<Separator />

			<div className="flex justify-end">
				<Button
					disabled={mutation.isPending || !dirty}
					onClick={() => mutation.mutate()}
				>
					{mutation.isPending
						? m["store.closures.saving"]()
						: m["store.closures.save"]()}
				</Button>
			</div>
		</div>
	);
}
