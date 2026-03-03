import {
	S3Client as AwsS3Client,
	CreateBucketCommand,
	HeadBucketCommand,
	PutBucketPolicyCommand,
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
	let created = false;

	try {
		await awsS3.send(new HeadBucketCommand({ Bucket: bucket }));
	} catch (err: any) {
		if (err.name !== "NotFound" && err.$metadata?.httpStatusCode !== 404) {
			throw err;
		}
		await awsS3.send(new CreateBucketCommand({ Bucket: bucket }));
		created = true;
	}

	// Ensure anonymous read access so images are served directly via URL
	const policy = JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Principal: "*",
				Action: ["s3:GetObject"],
				Resource: [`arn:aws:s3:::${bucket}/*`],
			},
		],
	});
	await awsS3.send(
		new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy }),
	);

	if (created) {
		console.log(`🪣 Bucket "${bucket}" created (public-read)`);
	}
}

/**
 * Checks S3/MinIO connectivity by sending a HeadBucket request.
 * Returns true if the bucket is reachable, false otherwise.
 */
export async function checkBucket(): Promise<boolean> {
	try {
		await awsS3.send(new HeadBucketCommand({ Bucket: bucket }));
		return true;
	} catch {
		return false;
	}
}

/** Returns the public URL for a given S3 object key. */
export function publicUrl(key: string) {
	return `${endpoint}/${bucket}/${key}`;
}
