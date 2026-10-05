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
import { toast } from "@bibs/ui/components/sonner";
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
	};

	const verifyMutation = useMutation({
		mutationFn: async (sellerId: string) => {
			const response = await api().admin.sellers({ sellerId }).verify.patch();
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
			toast.error(error.message || m.sellers_verify_failed());
		},
	});

	const rejectMutation = useMutation({
		mutationFn: async (sellerId: string) => {
			const response = await api().admin.sellers({ sellerId }).reject.patch();
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
			toast.error(error.message || m.sellers_reject_failed());
		},
	});

	const confirm = () => {
		if (!target) return;
		const mutation = target.type === "verify" ? verifyMutation : rejectMutation;
		mutation.mutate(target.sellerId);
	};

	return {
		target,
		setTarget,
		confirm,
		isPending: verifyMutation.isPending || rejectMutation.isPending,
	};
}

export function SellerModerationDialog({
	target,
	onOpenChange,
	onConfirm,
	isPending,
}: {
	target: ModerationTarget | null;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	isPending: boolean;
}) {
	const isVerify = target?.type === "verify";
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
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>
						{m.common_cancel()}
					</AlertDialogCancel>
					<AlertDialogAction
						variant={isVerify ? "success" : "destructive"}
						onClick={onConfirm}
						disabled={isPending}
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
