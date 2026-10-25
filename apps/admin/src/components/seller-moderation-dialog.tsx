import {
	SELLER_REJECTION_REASONS,
	type SellerRejectionFixStep,
} from "@bibs/api/schemas";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { Field, FieldDescription, FieldLabel } from "@bibs/ui/components/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { RadioGroup, RadioGroupItem } from "@bibs/ui/components/radio-group";
import { toast } from "@bibs/ui/components/sonner";
import { Textarea } from "@bibs/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { richMessage } from "@/lib/rich-message";
import { m } from "@/paraglide/messages";

export interface ModerationTarget {
	type: "verify" | "reject";
	sellerId: string;
	/** Pre-resolved display name: organization?.businessName ?? displayName(user) */
	sellerName: string;
	/** Seller's updatedAt as shown on the page: the API 409s if it changed since. */
	updatedAt: Date;
}

/** Body of PATCH /admin/sellers/:id/reject (RejectSellerBody). */
export interface Rejection {
	reason: string;
	fixStep: SellerRejectionFixStep | null;
}

/**
 * Form → body of the reject call. `choice` is an index into
 * SELLER_REJECTION_REASONS or "other" (hand-written reason + chosen outcome);
 * null while the form is incomplete.
 */
export function rejectionFromForm(
	choice: number | "other" | null,
	otherText: string,
	otherFixStep: SellerRejectionFixStep | null,
): Rejection | null {
	if (choice === null) return null;
	if (choice === "other") {
		const reason = otherText.trim();
		return reason ? { reason, fixStep: otherFixStep } : null;
	}
	const preset = SELLER_REJECTION_REASONS[choice];
	return { reason: preset.label, fixStep: preset.fixStep };
}

/**
 * Owns the verify/reject mutations + confirm-dialog target state shared by the
 * sellers list and the seller detail page. Pass `extraInvalidateKey` to also
 * invalidate a page-specific query (the detail page passes its detail key).
 */
export function useSellerModeration(opts?: {
	extraInvalidateKey?: readonly unknown[];
}) {
	const queryClient = useQueryClient();
	const [target, setTarget] = useState<ModerationTarget | null>(null);

	const invalidateLists = () => {
		if (opts?.extraInvalidateKey) {
			void queryClient.invalidateQueries({ queryKey: opts.extraInvalidateKey });
		}
		void queryClient.invalidateQueries({ queryKey: ["admin-sellers"] });
		void queryClient.invalidateQueries({ queryKey: ["admin-sellers-counts"] });
		void queryClient.invalidateQueries({ queryKey: ["admin-requests"] });
	};

	const verifyMutation = useMutation({
		mutationFn: async ({ sellerId, updatedAt }: ModerationTarget) => {
			const response = await api()
				.admin.sellers({ sellerId })
				.verify.patch({ expectedUpdatedAt: updatedAt });
			if (response.error) {
				throw new Error(
					response.error.value?.message || m.sellers_verify_error(),
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateLists();
			setTarget(null);
			toast.success(m.sellers_verify_success());
		},
		onError: (error: Error) => {
			// Already decided or resubmitted meanwhile: close on the old version
			// and show the current data.
			invalidateLists();
			setTarget(null);
			toast.error(error.message || m.sellers_verify_failed());
		},
	});

	const rejectMutation = useMutation({
		mutationFn: async ({
			target: { sellerId, updatedAt },
			rejection,
		}: {
			target: ModerationTarget;
			rejection: Rejection;
		}) => {
			const response = await api()
				.admin.sellers({ sellerId })
				.reject.patch({ ...rejection, expectedUpdatedAt: updatedAt });
			if (response.error) {
				throw new Error(
					response.error.value?.message || m.sellers_reject_error(),
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateLists();
			setTarget(null);
			toast.success(m.sellers_reject_success());
		},
		onError: (error: Error) => {
			invalidateLists();
			setTarget(null);
			toast.error(error.message || m.sellers_reject_failed());
		},
	});

	const confirm = (rejection?: Rejection) => {
		if (!target) return;
		if (target.type === "verify") verifyMutation.mutate(target);
		else if (rejection) rejectMutation.mutate({ target, rejection });
	};

	return {
		target,
		setTarget,
		confirm,
		isPending: verifyMutation.isPending || rejectMutation.isPending,
	};
}

const OUTCOME_LABEL = {
	document: m.sellers_reject_outcome_document,
	company: m.sellers_reject_outcome_company,
	definitive: m.sellers_reject_outcome_definitive,
};

const FIX_OPTIONS = [
	{ value: "none", label: m.sellers_reject_fix_none },
	{ value: "document", label: m.sellers_reject_fix_document },
	{ value: "company", label: m.sellers_reject_fix_company },
] as const;

/** Reason picker; reports the reject body (or null while incomplete) upward. */
function RejectionFields({
	onChange,
}: {
	onChange: (rejection: Rejection | null) => void;
}) {
	const [choice, setChoice] = useState<number | "other" | null>(null);
	const [otherText, setOtherText] = useState("");
	const [otherFixStep, setOtherFixStep] =
		useState<SellerRejectionFixStep | null>(null);

	const update = (
		next: Partial<{
			choice: number | "other" | null;
			otherText: string;
			otherFixStep: SellerRejectionFixStep | null;
		}>,
	) => {
		const merged = { choice, otherText, otherFixStep, ...next };
		setChoice(merged.choice);
		setOtherText(merged.otherText);
		setOtherFixStep(merged.otherFixStep);
		onChange(
			rejectionFromForm(merged.choice, merged.otherText, merged.otherFixStep),
		);
	};

	const presetFixStep =
		typeof choice === "number"
			? SELLER_REJECTION_REASONS[choice].fixStep
			: null;

	return (
		<div className="flex flex-col gap-4">
			<Field>
				<FieldLabel htmlFor="reject-reason">
					{m.sellers_reject_reason_label()}
				</FieldLabel>
				<NativeSelect
					id="reject-reason"
					value={choice === null ? "" : String(choice)}
					onChange={(e) => {
						const v = e.target.value;
						update({ choice: v === "" ? null : v === "other" ? v : Number(v) });
					}}
				>
					<NativeSelectOption value="" disabled>
						{m.sellers_reject_reason_placeholder()}
					</NativeSelectOption>
					{SELLER_REJECTION_REASONS.map((r, i) => (
						<NativeSelectOption key={r.label} value={String(i)}>
							{r.label}
						</NativeSelectOption>
					))}
					<NativeSelectOption value="other">
						{m.sellers_reject_reason_other()}
					</NativeSelectOption>
				</NativeSelect>
				{typeof choice === "number" && (
					<FieldDescription>
						{OUTCOME_LABEL[presetFixStep ?? "definitive"]()}
					</FieldDescription>
				)}
			</Field>

			{choice === "other" && (
				<>
					<Field>
						<FieldLabel htmlFor="reject-other-text">
							{m.sellers_reject_other_text_label()}
						</FieldLabel>
						<Textarea
							id="reject-other-text"
							maxLength={500}
							value={otherText}
							onChange={(e) => update({ otherText: e.target.value })}
						/>
						<FieldDescription>
							{m.sellers_reject_other_text_hint()}
						</FieldDescription>
					</Field>
					<Field>
						<FieldLabel id="reject-fix-label">
							{m.sellers_reject_fix_label()}
						</FieldLabel>
						<RadioGroup
							aria-labelledby="reject-fix-label"
							value={otherFixStep ?? "none"}
							onValueChange={(v) =>
								update({
									otherFixStep:
										v === "none" ? null : (v as SellerRejectionFixStep),
								})
							}
						>
							{FIX_OPTIONS.map((o) => (
								<label
									key={o.value}
									htmlFor={`reject-fix-${o.value}`}
									className="flex cursor-pointer items-center gap-2 text-sm"
								>
									<RadioGroupItem
										id={`reject-fix-${o.value}`}
										value={o.value}
									/>
									{o.label()}
								</label>
							))}
						</RadioGroup>
					</Field>
				</>
			)}
		</div>
	);
}

export function SellerModerationDialog({
	target,
	onOpenChange,
	onConfirm,
	isPending,
}: {
	target: ModerationTarget | null;
	onOpenChange: (open: boolean) => void;
	onConfirm: (rejection?: Rejection) => void;
	isPending: boolean;
}) {
	const isVerify = target?.type === "verify";
	const [rejection, setRejection] = useState<Rejection | null>(null);
	// A new target starts with an empty reason (the fields remount via key).
	const [seenTarget, setSeenTarget] = useState(target);
	if (seenTarget !== target) {
		setSeenTarget(target);
		setRejection(null);
	}

	return (
		<AlertDialog open={!!target} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{isVerify ? m.sellers_verify_title() : m.sellers_reject_title()}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{richMessage(
							(isVerify
								? m.sellers_verify_description
								: m.sellers_reject_description)({ name: "{name}" }),
							{ name: <strong>{target?.sellerName}</strong> },
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{target?.type === "reject" && (
					<RejectionFields key={target.sellerId} onChange={setRejection} />
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>
						{m.common_cancel()}
					</AlertDialogCancel>
					<AlertDialogAction
						variant={isVerify ? "success" : "destructive"}
						onClick={() =>
							onConfirm(isVerify ? undefined : (rejection ?? undefined))
						}
						disabled={isPending || (!isVerify && !rejection)}
					>
						{isPending
							? m.common_please_wait()
							: isVerify
								? m.sellers_approve()
								: m.sellers_reject()}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
