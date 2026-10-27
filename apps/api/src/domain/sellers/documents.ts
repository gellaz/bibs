import { logger } from "@/infra/logger";

// Document photos are personal data: delete the ones nobody references any
// more. Best-effort, after the commit: a failed delete leaves an orphan file,
// never a half-applied decision. A decided request's changeData may point at a
// deleted key: the admin detail hides the photo once the request isn't pending.
export async function deleteDocumentImage(
	key: string,
	sellerProfileId: string,
	action: string,
) {
	const { s3 } = await import("@/infra/s3");
	await s3.delete(key).catch((err) => {
		logger.warn(
			{ sellerProfileId, key, action, err: String(err) },
			"Cleanup foto del documento fallito",
		);
	});
}
