export type ConsumerRequestStateKind = "empty" | "rejected" | "timeout" | "failed" | "stopped";

export interface ConsumerRequestState {
  kind: ConsumerRequestStateKind;
  title: string;
  message: string;
  retryable: boolean;
  stopped?: boolean;
}

export function getPublicConsumerError(
  code: string | undefined,
  retryable: boolean,
  _unsafeDetail?: unknown,
): ConsumerRequestState {
  const normalized = code?.toUpperCase();
  if (normalized === "EMPTY_RESULT" || normalized === "NOT_FOUND") {
    return {
      kind: "empty",
      title: "暂未查到相关记录",
      message: "当前演示身份下暂无可展示的申请记录。",
      retryable: false,
    };
  }
  if (normalized === "UNAUTHORIZED") {
    return {
      kind: "rejected",
      title: "需要重新确认演示身份",
      message: "本次身份确认已失效，请重新发起查询并确认当前演示账号。",
      retryable: false,
    };
  }
  if (["BUSINESS_REJECTED", "CONFLICT", "INVALID_INPUT"].includes(normalized ?? "")) {
    return {
      kind: "rejected",
      title: "当前申请无法继续",
      message: "当前业务状态暂不支持这项操作，请检查订单或申请状态后重新发起。",
      retryable: false,
    };
  }
  if (normalized === "TIMEOUT" || normalized === "TOOL_TIMEOUT") {
    return {
      kind: "timeout",
      title: "服务响应超时",
      message: "暂未收到处理结果，你可以安全重试；系统会避免重复提交。",
      retryable: true,
    };
  }
  return {
    kind: "failed",
    title: "服务暂时不可用",
    message: "这次没有处理完成，你的输入已保留，请稍后重试。",
    retryable,
  };
}

export function getStoppedConsumerState(): ConsumerRequestState {
  return {
    kind: "stopped",
    title: "已停止生成",
    message: "未完成的回复和尚未执行的提交已终止。",
    retryable: true,
    stopped: true,
  };
}
