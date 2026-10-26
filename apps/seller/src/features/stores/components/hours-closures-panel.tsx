import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { cn } from "@bibs/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FormSection } from "@/components/form-section";
import { SaveBar } from "@/components/save-bar";
import { sellerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";
import {
	type ClosuresDraft,
	type CustomClosure,
	type HolidayRow,
	type PendingClosure,
	pendingToClosure,
	romeToday,
	serializeClosures,
	splitCustomClosures,
} from "../lib/closure-rows";
import { validateOpeningHours } from "../lib/validate-opening-hours";
import { ClosuresList } from "./closures-list";
import { type DaySchedule, OpeningHoursEditor } from "./opening-hours-editor";
import { serializeOpeningHours } from "./store-form";

interface ClosuresState {
	holidays: HolidayRow[];
	/** Chiusure già finite: non si mostrano, ma il PUT le rimanda intatte. */
	past: CustomClosure[];
	saved: ClosuresDraft;
	draft: ClosuresDraft;
}

/** Risposta chiusure → stato del pannello (le date sono già YYYY-MM-DD). */
function toClosuresState(raw: {
	holidays: HolidayRow[];
	customClosures: CustomClosure[];
}): ClosuresState {
	const { holidays } = raw;
	const { past, upcoming } = splitCustomClosures(
		raw.customClosures,
		romeToday(),
	);
	const saved = {
		optOutIds: holidays.filter((h) => !h.observed).map((h) => h.definitionId),
		customClosures: upcoming,
	};
	return { holidays, past, saved, draft: saved };
}

/**
 * Scheda «Orari e chiusure»: la settimana tipo e le sue eccezioni, affiancate,
 * con un solo Salva. Le chiusure sono del titolare: in sola lettura non si
 * caricano (l'API risponde 403 al dipendente).
 */
export function HoursClosuresPanel({
	storeId,
	openingHours,
	readOnly,
}: {
	storeId: string;
	openingHours: DaySchedule[];
	readOnly: boolean;
}) {
	const qc = useQueryClient();
	const [hours, setHours] = useState(openingHours);
	const [savedHours, setSavedHours] = useState(openingHours);
	const hoursDirty =
		serializeOpeningHours(hours) !== serializeOpeningHours(savedHours);
	const dayErrors = useMemo(() => validateOpeningHours(hours), [hours]);
	const hoursInvalid = Object.keys(dayErrors).length > 0;

	const closuresQuery = useQuery({
		queryKey: ["store-closures", storeId],
		queryFn: async () =>
			(
				await unwrapJson(
					await sellerApi.stores[":storeId"].closures.$get({
						param: { storeId },
					}),
					m.store_closures_error(),
				)
			).data,
		enabled: !readOnly,
	});
	const [closures, setClosures] = useState<ClosuresState | null>(null);
	if (closuresQuery.data && !closures) {
		setClosures(toClosuresState(closuresQuery.data));
	}
	const [pending, setPending] = useState<PendingClosure | null>(null);
	const pendingClosure = pendingToClosure(pending, romeToday());
	// Dal passato o Al prima di Dal nel modulo aperto: non si salva finché non
	// si corregge.
	const pendingInvalid = !!pending?.start && !pendingClosure;
	const closuresDirty =
		!!closures &&
		(pendingClosure !== null ||
			serializeClosures(closures.draft) !== serializeClosures(closures.saved));

	// In sequenza, e ogni parte riuscita diventa la nuova base: se le chiusure
	// falliscono dopo gli orari, resta da salvare solo ciò che non è passato.
	const save = useMutation({
		mutationFn: async () => {
			if (hoursDirty) {
				await unwrapJson(
					await sellerApi.stores[":storeId"].$patch({
						param: { storeId },
						json: { openingHours: hours.length > 0 ? hours : null },
					}),
					m.store_update_error(),
				);
				setSavedHours(hours);
			}
			if (closures && closuresDirty) {
				const next = (
					await unwrapJson(
						await sellerApi.stores[":storeId"].closures.$put({
							param: { storeId },
							json: {
								optOutIds: closures.draft.optOutIds,
								customClosures: [
									...closures.past,
									...closures.draft.customClosures,
									...(pendingClosure ? [pendingClosure] : []),
								],
							},
						}),
						m.store_closures_error(),
					)
				).data;
				setClosures(toClosuresState(next));
				setPending(null);
			}
		},
		onSuccess: () => toast.success(m.store_hours_closures_saved()),
		onError: (error: Error) => toast.error(error.message),
		onSettled: () => {
			void qc.invalidateQueries({ queryKey: ["stores"] });
			void qc.invalidateQueries({ queryKey: ["store", storeId] });
			void qc.invalidateQueries({ queryKey: ["store-closures", storeId] });
		},
	});

	return (
		<div
			className={cn(
				"@container flex flex-1 flex-col gap-10",
				readOnly && "max-w-3xl",
			)}
		>
			{/* Spento mentre salva: la risposta riscrive orari e chiusure, e una
			    modifica fatta nel frattempo andrebbe persa senza essere inviata. */}
			<fieldset
				disabled={save.isPending}
				className="grid min-w-0 gap-x-10 gap-y-12 @5xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
			>
				<FormSection
					title={m.store_hours_week_title()}
					description={m.store_hours_week_description()}
				>
					{!hours.some((d) => d.slots.length > 0) && (
						<p className="rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground text-sm">
							{m.store_form_hours_missing()}
						</p>
					)}
					<OpeningHoursEditor
						value={hours}
						onChange={setHours}
						readOnly={readOnly}
						dayErrors={dayErrors}
					/>
				</FormSection>

				{!readOnly && (
					<FormSection
						title={m.store_closures_title()}
						description={m.store_closures_list_description()}
					>
						{closuresQuery.error ? (
							<div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-destructive text-sm">
								{closuresQuery.error.message}
							</div>
						) : !closures ? (
							<div className="flex justify-center py-12">
								<Spinner />
							</div>
						) : (
							<ClosuresList
								holidays={closures.holidays}
								value={closures.draft}
								onChange={(draft) => setClosures({ ...closures, draft })}
								pending={pending}
								onPendingChange={setPending}
							/>
						)}
					</FormSection>
				)}
			</fieldset>

			{!readOnly && (
				<SaveBar
					dirty={hoursDirty || closuresDirty}
					pending={save.isPending}
					disabled={hoursInvalid || pendingInvalid}
					submitLabel={m.store_settings_save()}
					pendingLabel={m.store_settings_saving()}
					onSave={() => save.mutate()}
				/>
			)}
		</div>
	);
}
