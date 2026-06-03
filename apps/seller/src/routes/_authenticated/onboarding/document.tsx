import { DocumentBody } from "@bibs/api/schemas";
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
import { MunicipalityCombobox } from "@bibs/ui/components/municipality-combobox";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { UploadIcon } from "lucide-react";
import { useState } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import {
	municipalitiesQueryOptions,
	useMunicipalities,
} from "@/hooks/use-municipalities";
import { useGoBack, useUpdateDocument } from "@/hooks/use-onboarding";

type DocumentFormData = Static<typeof DocumentBody>;
const compiledSchema = TypeCompiler.Compile(DocumentBody);

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

	const {
		register,
		handleSubmit,
		control,
		formState: { errors, isSubmitting },
	} = useForm<DocumentFormData>({
		resolver: typeboxResolver(compiledSchema),
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

				<Field data-invalid={!!errors.documentIssuedMunicipalityId}>
					<FieldLabel htmlFor="documentIssuedMunicipalityId">
						Comune di emissione documento
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
								aria-invalid={!!errors.documentIssuedMunicipalityId}
							/>
						)}
					/>
					<FieldError errors={[errors.documentIssuedMunicipalityId]} />
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
						<DropzoneContent>
							<div className="flex flex-col items-center justify-center">
								<div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
									<UploadIcon className="size-4" />
								</div>
								<p className="my-2 text-sm font-medium">Foto caricata</p>
								<p className="text-muted-foreground text-xs">
									Clicca o trascina per sostituire
								</p>
							</div>
						</DropzoneContent>
						<DropzoneEmptyState>
							<div className="flex flex-col items-center justify-center">
								<div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
									<UploadIcon className="size-4" />
								</div>
								<p className="my-2 text-sm font-medium">
									Trascina la foto o clicca per caricare
								</p>
							</div>
						</DropzoneEmptyState>
					</Dropzone>
					<FieldDescription>JPG, PNG o WebP — max 10 MB</FieldDescription>
					{fileError && <p className="text-sm text-destructive">{fileError}</p>}
				</Field>

				<div className="mt-2 flex flex-col gap-2 sm:flex-row-reverse">
					<Button
						type="submit"
						disabled={isSubmitting || goBackMutation.isPending}
						className="flex-1"
					>
						{isSubmitting ? "Caricamento..." : "Continua"}
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
								setApiError(err instanceof Error ? err.message : "Errore");
							}
						}}
					>
						{goBackMutation.isPending ? "Attendere..." : "Indietro"}
					</Button>
				</div>
			</form>
		</OnboardingLayout>
	);
}
