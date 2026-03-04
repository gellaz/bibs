import { Button } from "@bibs/ui/components/button";
import {
	Dropzone,
	DropzoneContent,
	DropzoneEmptyState,
} from "@bibs/ui/components/dropzone";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import {
	type DocumentFormData,
	documentSchema,
} from "@/features/onboarding/schemas";
import { useUpdateDocument } from "@/hooks/use-onboarding";

export const Route = createFileRoute("/_authenticated/onboarding/document")({
	component: DocumentPage,
});

function DocumentPage() {
	const navigate = useNavigate();
	const mutation = useUpdateDocument();
	const [apiError, setApiError] = useState("");
	const [documentImage, setDocumentImage] = useState<File | null>(null);
	const [fileError, setFileError] = useState("");

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<DocumentFormData>({
		resolver: zodResolver(documentSchema),
	});

	const onSubmit: SubmitHandler<DocumentFormData> = async (data) => {
		setApiError("");
		if (!documentImage) {
			setFileError("La foto del documento è obbligatoria");
			return;
		}
		try {
			await mutation.mutateAsync({
				...data,
				documentImage,
			});
			void navigate({ to: "/onboarding/company" });
		} catch (err) {
			setApiError(
				err instanceof Error ? err.message : "Errore durante il caricamento",
			);
		}
	};

	return (
		<OnboardingLayout
			currentStatus="pending_document"
			title="Documento d'identità"
			description="Carica la tua carta d'identità"
		>
			<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
				{apiError && (
					<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{apiError}
					</div>
				)}

				<Field data-invalid={!!errors.documentNumber}>
					<FieldLabel htmlFor="documentNumber">Numero documento</FieldLabel>
					<Input
						id="documentNumber"
						placeholder="CA12345AB"
						autoFocus
						{...register("documentNumber")}
					/>
					<FieldError errors={[errors.documentNumber]} />
				</Field>

				<Field data-invalid={!!errors.documentExpiry}>
					<FieldLabel htmlFor="documentExpiry">Data di scadenza</FieldLabel>
					<Input
						id="documentExpiry"
						type="date"
						{...register("documentExpiry")}
					/>
					<FieldError errors={[errors.documentExpiry]} />
				</Field>

				<Field data-invalid={!!errors.documentIssuedMunicipality}>
					<FieldLabel htmlFor="documentIssuedMunicipality">
						Comune di rilascio
					</FieldLabel>
					<Input
						id="documentIssuedMunicipality"
						placeholder="Roma"
						{...register("documentIssuedMunicipality")}
					/>
					<FieldError errors={[errors.documentIssuedMunicipality]} />
				</Field>

				<Field data-invalid={!!fileError}>
					<FieldLabel>Foto del documento</FieldLabel>
					<Dropzone
						accept={{ "image/*": [".jpg", ".jpeg", ".png", ".webp"] }}
						maxSize={10 * 1024 * 1024}
						maxFiles={1}
						src={documentImage ? [documentImage] : undefined}
						onDrop={(files) => {
							setDocumentImage(files[0] ?? null);
							setFileError("");
						}}
						onError={(err) => setFileError(err.message)}
					>
						<DropzoneContent />
						<DropzoneEmptyState />
					</Dropzone>
					<FieldDescription>JPG, PNG o WebP — max 10 MB</FieldDescription>
					{fileError && <p className="text-sm text-destructive">{fileError}</p>}
				</Field>

				<Button type="submit" disabled={isSubmitting} className="w-full mt-2">
					{isSubmitting ? "Caricamento..." : "Continua"}
				</Button>
			</form>
		</OnboardingLayout>
	);
}
