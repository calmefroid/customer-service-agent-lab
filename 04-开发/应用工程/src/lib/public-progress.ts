import type { ChatRequest } from "@/lib/contracts";

export interface PublicProgressPlan {
  title: string;
  steps: string[];
}

export function getPublicProgressPlan(
  request: Omit<ChatRequest, "sessionId">,
): PublicProgressPlan | undefined {
  if (request.attachment) {
    return {
      title: "正在整理退换申请",
      steps: ["识别图片中的商品问题", "核对适用的售后规则", "生成可编辑的申请草稿"],
    };
  }

  if (/预约.*安装|上门安装|安装师傅/.test(request.message)) {
    return {
      title: "正在整理安装服务信息",
      steps: ["识别服务类型", "核对预约所需字段", "生成可编辑服务单"],
    };
  }

  if (/型号|参数|单电机|双电机|WIFI|WiFi|wifi|功能|认证|质保|保修|安装视频|门店|验真/.test(request.message)) {
    return {
      title: "正在查询相关信息",
      steps: ["识别问题主题", "查询产品或知识库", "整理适用说明"],
    };
  }

  switch (request.action) {
    case "confirm_identity":
      return { title: "正在查询订单物流", steps: ["验证查询权限", "读取最近订单", "获取最新物流轨迹"] };
    case "prepare_logistics_urge":
      return { title: "正在准备物流催办", steps: ["读取最新物流状态", "核对催办条件", "生成催办确认信息"] };
    case "submit_logistics_urge":
      return { title: "正在提交物流催办", steps: ["校验你的确认", "提交物流平台", "同步人工客服跟进"] };
    case "submit_return":
      return { title: "正在创建退换货申请", steps: ["校验申请信息", "创建退换货申请单", "同步售后处理队列"] };
    case "prepare_service_ticket":
      return { title: "正在整理服务信息", steps: ["汇总问题与处理结果", "核对服务所需字段", "生成可编辑服务单"] };
    case "submit_service_ticket":
      return { title: "正在创建售后工单", steps: ["校验服务信息", "创建售后工单", "同步服务网点预约"] };
    case "confirm_service_identity":
      return { title: "正在查询报修进度", steps: ["验证查询权限", "读取最近售后工单", "整理最新处理进度"] };
    default:
      return undefined;
  }
}
