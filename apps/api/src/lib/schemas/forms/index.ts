// Side effect: registers `format: "calendar-date"` for TypeCompiler users (seller forms).
import "./formats";

export {
	DOCUMENT_NUMBER_EXAMPLES,
	IDENTITY_DOCUMENT_TYPES,
	type IdentityDocumentType,
	isDocumentExpired,
	isValidDocumentNumber,
	normalizeDocumentNumber,
	todayInRome,
} from "./identity-document";
export {
	AcceptInviteBody,
	CompanyBody,
	DocumentBody,
	PersonalInfoBody,
	TeamInviteBody,
} from "./onboarding";
export { OpeningHoursSchema } from "./opening-hours";
export {
	CharacteristicValueInputSchema,
	CharacteristicValuesField,
	CreateProductBody,
	VatRateSchema,
} from "./products";
export {
	RejectSellerBody,
	SELLER_REJECTION_FIX_STEPS,
	SELLER_REJECTION_REASONS,
	type SellerRejectionFixStep,
	SUPPORT_EMAIL,
} from "./seller-rejection";
export {
	CompanySettingsBody,
	DocumentChangeBody,
	PersonalSettingsBody,
	VatChangeBody,
} from "./settings";
export { CreateStoreBody } from "./stores";
