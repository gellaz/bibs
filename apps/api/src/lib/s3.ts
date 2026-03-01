import {
	S3Client as AwsS3Client,
	CreateBucketCommand,
	HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { S3Client } from "bun";
import { env } from "@/lib/env";

const endpoint = env.S3_ENDPOINT;
const bucket = env.S3_BUCKET;

export const s3 = new S3Client({
	accessKeyId: env.S3_ACCESS_KEY,
	secretAccessKey: env.S3_SECRET_KEY,
	bucket,
	endpoint,
});

const awsS3 = new AwsS3Client({
	endpoint,
	region: "us-east-1",
	credentials: {
		accessKeyId: env.S3_ACCESS_KEY,
		secretAccessKey: env.S3_SECRET_KEY,
	},
	forcePathStyle: true,
});

/**
 * Creates the S3 bucket if it doesn't already exist.
 * Called once at application startup.
 */
export async function ensureBucket() {
	try {
		await awsS3.send(new HeadBucketCommand({ Bucket: bucket }));
		return; // bucket exists
	} catch (err: any) {
		if (err.name !== "NotFound" && err.$metadata?.httpStatusCode !== 404) {
			throw err;
		}
	}

	await awsS3.send(new CreateBucketCommand({ Bucket: bucket }));
	console.log(`🪣 Bucket "${bucket}" created`);
}

/** Returns the public URL for a given S3 object key. */
export function publicUrl(key: string) {
	return `${endpoint}/${bucket}/${key}`;
}
