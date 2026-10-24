import {
	DOCUMENT_NUMBER_EXAMPLES,
	DocumentBody,
	IDENTITY_DOCUMENT_TYPES,
	type IdentityDocumentType,
	isDocumentExpired,
	isValidDocumentNumber,
	normalizeDocumentNumber,
	todayInRome,
} from "@bibs/api/schemas";
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
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { MunicipalityCombobox } from "@bibs/ui/custom/municipality-combobox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { UploadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import {
	municipalitiesQueryOptions,
	municipalityComboboxLabels,
	useMunicipalities,
} from "@/hooks/use-municipalities";
import { useGoBack, useUpdateDocument } from "@/hooks/use-onboarding";
import { typeboxResolver } from "@/lib/typebox-resolver";
import { m } from "@/paraglide/messages";

type DocumentFormData = Static<typeof DocumentBody>;
const compiledSchema = TypeCompiler.Compile(DocumentBody);

const DOCUMENT_TYPE_LABEL: Record<IdentityDocumentType, () => string> = {
	identity_card: m.onboarding_document_type_identity_card,
	driving_license: m.onboarding_document_type_driving_license,
	passport: m.onboarding_document_type_passport,
};

export const Route = createFileRoute("/_authenticated/onboarding/document")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(municipalitiesQueryOptions()),
	component: DocumentPage,
});

function DocumentPage() {
	const navigate = useNavigate();
	const mutation = useUpdateDocument();
	const goBackMutation = useGoBack();
	const {
		data: municipalities,
		isLoading: municipalitiesLoading,
		isError: municipalitiesError,
	} = useMunicipalities();
	const [apiError, setApiError] = useState("");
	const [documentImage, setDocumentImage] = useState<File | null>(null);
	const [fileError, setFileError] = useState("");
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	// L'URL nasce e muore nell'effetto: con StrictMode un URL creato in render
	// verrebbe revocato mentre è ancora a schermo.
	useEffect(() => {
		if (!documentImage) {
			setPreviewUrl(null);
			return;
		}
		const url = URL.createObjectURL(documentImage);
		setPreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [documentImage]);

	const {
		register,
		handleSubmit,
		control,
		setError,
		watch,
		formState: { errors, isSubmitting },
	} = useForm<DocumentFormData>({
		resolver: typeboxResolver(compiledSchema),
	});
	const documentType = watch("documentType");

	const onSubmit: SubmitHandler<DocumentFormData> = async (data) => {
		setApiError("");
		// Gli stessi controlli dell'API, qui per avere l'errore sotto il campo.
		const documentNumber = normalizeDocumentNumber(data.documentNumber);
		let invalid = false;
		if (!isValidDocumentNumber(data.documentType, documentNumber)) {
			setError("documentNumber", {
				message: m.onboarding_document_number_invalid({
					example: DOCUMENT_NUMBER_EXAMPLES[data.documentType],
				}),
			});
			invalid = true;
		}
		if (isDocumentExpired(data.documentExpiry, todayInRome())) {
			setError("documentExpiry", { message: m.onboarding_document_expired() });
			invalid = true;
		}
		if (!documentImage) {
			setFileError(m.onboarding_document_photo_required());
			invalid = true;
		}
		if (invalid || !documentImage) return;
		try {
			const { data: updated } = await mutation.mutateAsync({
				...data,
				documentNumber,
				documentImage,
			});
			// Resubmission after a "document" rejection skips the company step.
			void navigate({
				to:
					updated.onboardingStatus === "pending_review"
						? "/onboarding/pending"
						: "/onboarding/company",
			});
		} catch (err) {
			setApiError(
				err instanceof Error
					? err.message
					: m.onboarding_document_upload_error(),
			);
		}
	};

	return (
		<OnboardingLayout
			currentStatus="pending_document"
			title={m.onboarding_document_title()}
			description={m.onboarding_document_description()}
		>
			<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
				{apiError && (
					<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{apiError}
					</div>
				)}

				<Field data-invalid={!!errors.documentType}>
					<FieldLabel htmlFor="documentType">
						{m.onboarding_document_type()}
					</FieldLabel>
					<NativeSelect
						id="documentType"
						className="w-full"
						autoFocus
						{...register("documentType")}
					>
						<NativeSelectOption value="">
							{m.onboarding_document_type_placeholder()}
						</NativeSelectOption>
						{IDENTITY_DOCUMENT_TYPES.map((type) => (
							<NativeSelectOption key={type} value={type}>
								{DOCUMENT_TYPE_LABEL[type]()}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<FieldError errors={[errors.documentType]} />
				</Field>

				<Field data-invalid={!!errors.documentNumber}>
					<FieldLabel htmlFor="documentNumber">
						{m.onboarding_document_number()}
					</FieldLabel>
					<Input
						id="documentNumber"
						placeholder={
							DOCUMENT_NUMBER_EXAMPLES[documentType] ??
							DOCUMENT_NUMBER_EXAMPLES.identity_card
						}
						{...register("documentNumber")}
					/>
					<FieldError errors={[errors.documentNumber]} />
				</Field>

				<Field data-invalid={!!errors.documentExpiry}>
					<FieldLabel htmlFor="documentExpiry">
						{m.onboarding_document_expiry()}
					</FieldLabel>
					<Input
						id="documentExpiry"
						type="date"
						min={todayInRome()}
						{...register("documentExpiry")}
					/>
					<FieldError errors={[errors.documentExpiry]} />
				</Field>

				<Field data-invalid={!!errors.documentIssuedMunicipalityId}>
					<FieldLabel htmlFor="documentIssuedMunicipalityId">
						{m.onboarding_document_issued_municipality()}
					</FieldLabel>
					<Controller
						control={control}
						name="documentIssuedMunicipalityId"
						render={({ field }) => (
							<MunicipalityCombobox
								id="documentIssuedMunicipalityId"
								value={field.value ?? null}
								onChange={field.onChange}
								municipalities={municipalities}
								loading={municipalitiesLoading}
								error={municipalitiesError}
								labels={municipalityComboboxLabels()}
								aria-invalid={!!errors.documentIssuedMunicipalityId}
							/>
						)}
					/>
					<FieldError errors={[errors.documentIssuedMunicipalityId]} />
				</Field>

				<Field data-invalid={!!fileError}>
					<FieldLabel>{m.onboarding_document_photo()}</FieldLabel>
					<Dropzone
						accept={{ "image/*": [".jpg", ".jpeg", ".png", ".webp"] }}
						maxSize={10 * 1024 * 1024}
						maxFiles={1}
						src={documentImage ? [documentImage] : undefined}
						onDrop={(files) => {
							setDocumentImage(files[0] ?? null);
							setFileError("");
						}}
						// Il messaggio di react-dropzone è in inglese e con i byte grezzi
						// («File is larger than 10485760 bytes»): mostriamo il nostro.
						onError={() => setFileError(m.onboarding_document_photo_rejected())}
					>
						<DropzoneContent>
							<div className="flex flex-col items-center justify-center">
								{previewUrl ? (
									<img
										src={previewUrl}
										alt={m.onboarding_document_photo_preview_alt()}
										className="max-h-48 w-auto rounded-md object-contain"
									/>
								) : (
									<div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
										<UploadIcon className="size-4" />
									</div>
								)}
								<p className="my-2 text-sm font-medium">
									{m.onboarding_document_photo_uploaded()}
								</p>
								<p className="text-muted-foreground text-xs">
									{m.onboarding_document_photo_replace_hint()}
								</p>
							</div>
						</DropzoneContent>
						<DropzoneEmptyState>
							<div className="flex flex-col items-center justify-center">
								<div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
									<UploadIcon className="size-4" />
								</div>
								<p className="my-2 text-sm font-medium">
									{m.onboarding_document_photo_empty()}
								</p>
							</div>
						</DropzoneEmptyState>
					</Dropzone>
					<FieldDescription>
						{m.onboarding_document_photo_hint()}
					</FieldDescription>
					{fileError && <p className="text-sm text-destructive">{fileError}</p>}
				</Field>

				<div className="mt-2 flex flex-col gap-2 sm:flex-row-reverse">
					<Button
						type="submit"
						disabled={isSubmitting || goBackMutation.isPending}
						className="flex-1"
					>
						{isSubmitting ? m.onboarding_uploading() : m.onboarding_continue()}
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={isSubmitting || goBackMutation.isPending}
						className="flex-1"
						onClick={async () => {
							try {
								await goBackMutation.mutateAsync(undefined);
								void navigate({ to: "/onboarding/personal-info" });
							} catch (err) {
								setApiError(
									err instanceof Error ? err.message : m.common_error(),
								);
							}
						}}
					>
						{goBackMutation.isPending
							? m.onboarding_waiting()
							: m.common_back()}
					</Button>
				</div>
			</form>
		</OnboardingLayout>
	);
}
