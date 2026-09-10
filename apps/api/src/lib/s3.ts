/// <reference types="bun-types" />
import {
	S3Client as AwsS3Client,
	CreateBucketCommand,
	HeadBucketCommand,
	PutBucketPolicyCommand,
} from "@aws-sdk/client-s3";
import { S3Client } from "bun";
import { env } from "@/lib/env";
import { isConnectionError, retry } from "@/lib/retry";

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
 * Ensures the S3 bucket exists and is publicly readable.
 *
 * Runs once at startup, before the server begins listening, so a failure here
 * is fatal — it reports what to do instead of surfacing a raw socket trace.
 * Connection failures are retried to absorb a container that is running but
 * has not bound its port yet; see @/lib/retry.
 */
export async function ensureBucket() {
	try {
		await retry(provisionBucket);
	} catch (err) {
		if (isConnectionError(err)) {
			throw Object.assign(
				new Error(
					`S3 storage at ${endpoint} is unreachable. Start the local infrastructure with "bun run infra:up".`,
				),
				{ cause: err },
			);
		}
		throw err;
	}
}

/** Creates the bucket when missing, then (re)applies the public-read policy. */
async function provisionBucket() {
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
