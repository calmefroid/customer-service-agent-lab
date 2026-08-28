import type { AttachmentMeta } from "@/lib/contracts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function decodedBase64Bytes(value: string): number | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return undefined;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length / 4 * 3 - padding;
}

export function validateAttachment(attachment: AttachmentMeta | undefined): string | undefined {
  if (!attachment) return undefined;
  if (!ALLOWED_IMAGE_TYPES.has(attachment.type)) return "图片格式不支持";
  if (!Number.isFinite(attachment.size) || attachment.size < 0) return "图片大小无效";
  if (attachment.size > MAX_IMAGE_BYTES) return "图片不能超过 8MB";
  if (!attachment.dataUrl) return undefined;

  const match = attachment.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return "图片内容格式无效";
  if (match[1] !== attachment.type) return "图片类型与内容不匹配";
  const decodedBytes = decodedBase64Bytes(match[2]);
  if (decodedBytes === undefined) return "图片 Base64 内容无效";
  if (decodedBytes > MAX_IMAGE_BYTES) return "图片不能超过 8MB";
  if (decodedBytes !== attachment.size) return "图片内容大小与声明不匹配";
  return undefined;
}
