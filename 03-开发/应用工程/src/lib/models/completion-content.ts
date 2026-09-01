export type CompletionContent = string | Array<{ type?: string; text?: string }> | null;

const PRIVATE_CONTENT_TYPE = /reason|think|analysis/i;

/** Return only provider-visible final content; never expose private reasoning parts. */
export function visibleCompletionText(content: CompletionContent | undefined): string {
  const value = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((item) => !PRIVATE_CONTENT_TYPE.test(item.type ?? ""))
          .map((item) => item.text ?? "")
          .join("")
      : "";
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}
