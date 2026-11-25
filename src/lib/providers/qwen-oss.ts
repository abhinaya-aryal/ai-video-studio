import fs from "node:fs/promises";
import path from "node:path";
import {
  ProviderHttpError,
  mapProviderError,
  parseProviderErrorResponse,
} from "@/lib/providers/errors";
import { QWEN_ENDPOINT_PATHS } from "@/lib/providers/qwen-endpoints";

/** Files larger than 2 MiB always upload through DashScope temporary OSS. */
export const OSS_IMAGE_SIZE_THRESHOLD_BYTES = 2 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function inferMimeType(filePath: string, fallback = "application/octet-stream"): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? fallback;
}

interface UploadPolicyFields {
  policy?: string;
  signature?: string;
  upload_dir?: string;
  upload_host?: string;
  oss_access_key_id?: string;
  x_oss_object_acl?: string;
  x_oss_forbid_overwrite?: string;
}

export interface UploadToDashScopeOssParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  filePath: string;
  fetchFn?: typeof fetch;
}

/**
 * Upload a local file via DashScope's temporary OSS upload flow and return its
 * `oss://...` URI (valid for temporary model resolution).
 */
export async function uploadToDashScopeOss({
  baseUrl,
  apiKey,
  model,
  filePath,
  fetchFn = fetch,
}: UploadToDashScopeOssParams): Promise<string> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const policyUrl = `${cleanBase}${QWEN_ENDPOINT_PATHS.uploads}?action=getPolicy&model=${encodeURIComponent(model)}`;

  const policyRes = await fetchFn(policyUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!policyRes.ok) {
    throw await parseProviderErrorResponse(policyRes);
  }

  const rawJson = (await policyRes.json()) as {
    data?: UploadPolicyFields;
  } & UploadPolicyFields;
  const policy = rawJson.data ?? rawJson;

  if (!policy.upload_host || !policy.upload_dir) {
    throw new ProviderHttpError(
      mapProviderError("InvalidResponse", 502),
      502,
      "DashScope upload policy missing upload_host or upload_dir",
    );
  }

  const filename = path.basename(filePath);
  const key = `${policy.upload_dir.replace(/\/+$/, "")}/${filename}`;
  const fileBuffer = await fs.readFile(filePath);
  const mimeType = inferMimeType(filePath);

  const form = new FormData();
  if (policy.oss_access_key_id) {
    form.append("OSSAccessKeyId", policy.oss_access_key_id);
  }
  if (policy.policy) {
    form.append("policy", policy.policy);
  }
  if (policy.signature) {
    form.append("Signature", policy.signature);
  }
  form.append("key", key);
  if (policy.x_oss_object_acl) {
    form.append("x-oss-object-acl", policy.x_oss_object_acl);
  }
  if (policy.x_oss_forbid_overwrite) {
    form.append("x-oss-forbid-overwrite", policy.x_oss_forbid_overwrite);
  }
  form.append("success_action_status", "200");
  // Aliyun OSS POST policy requires `file` to be the final field in FormData.
  form.append("file", new Blob([fileBuffer], { type: mimeType }), filename);

  const uploadRes = await fetchFn(policy.upload_host, {
    method: "POST",
    body: form,
  });

  if (!uploadRes.ok) {
    throw await parseProviderErrorResponse(uploadRes);
  }

  return `oss://${key}`;
}

export interface PrepareImageMediaParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  filePath: string;
  imageCountInRequest: number;
  fetchFn?: typeof fetch;
}

/**
 * Prepare a local image file for a Qwen/Wan API request: upload via DashScope
 * OSS when larger than 2 MiB or when sending multiple images; otherwise encode
 * inline as a Base64 data URI.
 */
export async function prepareImageMedia({
  baseUrl,
  apiKey,
  model,
  filePath,
  imageCountInRequest,
  fetchFn = fetch,
}: PrepareImageMediaParams): Promise<string> {
  const stats = await fs.stat(filePath);
  if (stats.size > OSS_IMAGE_SIZE_THRESHOLD_BYTES || imageCountInRequest > 1) {
    return uploadToDashScopeOss({
      baseUrl,
      apiKey,
      model,
      filePath,
      fetchFn,
    });
  }

  const bytes = await fs.readFile(filePath);
  const mime = inferMimeType(filePath, "image/png");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
