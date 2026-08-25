import { beforeEach, describe, expect, it } from "vitest";

import { orchestrateMock } from "@/lib/mock-orchestrator";
import { resetKnowledgeStore } from "@/lib/knowledge-store";
import { getPublicProgressPlan } from "@/lib/public-progress";
import { clearTraces, listTraces } from "@/lib/trace-store";

const baseRequest = {
  sessionId: "test-session",
  message: "",
};

describe("mock orchestrator", () => {
  beforeEach(() => {
    clearTraces();
    resetKnowledgeStore();
  });

  it("产品知识通过隐藏路由回答，不增加首页入口", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "20 平米客厅怎么选灯？",
    });

    expect(response.intent).toBe("knowledge_query");
    expect(response.ui?.kind).toBe("knowledge_answer");
    const trace = listTraces("test-session")[0];
    expect(trace.route.module).toBe("knowledge");
    expect(trace.route.topic).toMatch(/^product\./);
    expect(trace.sources.map((source) => source.sourceSystem)).toContain("PCMP");
  });

  it("问候走闲聊话术并重新展示三个售后入口", async () => {
    const response = await orchestrateMock({ ...baseRequest, message: "你好" });
    expect(response.intent).toBe("smalltalk");
    expect(response.ui?.kind).toBe("service_menu");
  });

  it("选择故障报修后先等待自然语言描述", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "进入故障报修",
      action: "select_repair",
      module: "repair",
    });
    expect(response.ui?.kind).toBe("repair_intake");
    expect(listTraces("test-session")[0].steps).toContain("等待用户描述故障");
  });

  it("订单查询在身份确认前不读取订单", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "订单到哪了？",
    });

    expect(response.ui?.kind).toBe("identity_confirm");
    expect(listTraces("test-session")[0].sources).toHaveLength(0);
  });

  it("身份确认后返回订单和物流轨迹", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "查询最近订单",
      action: "confirm_identity",
    });

    expect(response.ui?.kind).toBe("order");
    expect(listTraces("test-session")[0].sources.map((source) => source.sourceSystem)).toEqual([
      "OMS",
      "TMS",
    ]);
    if (response.ui?.kind === "order") {
      expect(response.ui.order.carrier).toBe("顺丰速运");
      expect(response.ui.order.hotline).toBe("95338");
    }
    const trace = listTraces("test-session")[0];
    expect(trace.stages.some((stage) => stage.toolCall?.system === "OMS")).toBe(true);
    expect(trace.stages.some((stage) => stage.toolCall?.system === "TMS")).toBe(true);
    expect(trace.totalDurationMs).toBeGreaterThan(0);
  });

  it("物流催办先生成确认摘要，不执行写操作", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "准备物流催办",
      action: "prepare_logistics_urge",
    });

    expect(response.ui?.kind).toBe("logistics_urge_confirm");
    expect(listTraces("test-session")[0].steps).toContain("等待用户确认");
    expect(listTraces("test-session")[0].sources.map((source) => source.recordId)).not.toContain(
      "URGE20260820009",
    );
  });

  it("确认后提交物流平台并同步人工客服", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "提交物流催办",
      action: "submit_logistics_urge",
    });

    expect(response.ui?.kind).toBe("logistics_urge_success");
    expect(listTraces("test-session")[0].sources.map((source) => source.sourceSystem)).toEqual([
      "TMS",
      "CRM",
    ]);
  });

  it("冒烟场景先提示断电并自动升级人工", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "灯有烧焦味，还在冒烟",
    });

    expect(response.riskLevel).toBe("high");
    expect(response.message).toContain("断开对应电源");
    expect(response.ui?.kind).toBe("safety");
    expect(listTraces("test-session")[0].steps).toContain("自动升级人工");
  });

  it("图片场景只传元数据并生成待确认申请", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "灯罩破了",
      attachment: { name: "damage.jpg", type: "image/jpeg", size: 1024 },
    });

    expect(response.ui?.kind).toBe("return_confirm");
    expect(listTraces("test-session")[0].inputSummary).toContain("damage.jpg");
    if (response.ui?.kind === "return_confirm") {
      expect(response.ui.form.pickupAddress).toBeTruthy();
    }
  });

  it("退换货提交结果使用用户最终编辑的服务类型", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "提交退换货申请",
      action: "submit_return",
      formData: {
        serviceType: "退货",
        product: "悦享系列 LED 吸顶灯",
        issueDescription: "灯罩边缘破裂",
        contactPhone: "13800006821",
        pickupAddress: "上海市测试区测试路 18 号",
      },
    });

    expect(response.message).toContain("退货申请已提交");
    expect(listTraces("test-session")[0].steps).toContain("读取用户最终编辑的退货申请");
    const crmCall = listTraces("test-session")[0].stages.find((stage) => stage.toolCall?.system === "CRM")?.toolCall;
    expect(crmCall?.input.contact_phone).toBe("138****6821");
    expect(crmCall?.input.pickup_address).not.toContain("测试路 18 号");
  });

  it("普通闪烁故障返回安全排查步骤并记录知识来源", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "客厅灯一直闪，怎么处理？",
    });

    expect(response.intent).toBe("troubleshooting");
    expect(response.ui?.kind).toBe("troubleshooting");
    expect(listTraces("test-session")[0].sources[0].recordId).toBe("KB-AFTERSALE-TROUBLESHOOT-009");
  });

  it("故障报修模块优先把安全描述路由到高风险处理", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "刚才开始冒烟，还有烧焦味",
      module: "repair",
    });
    expect(response.intent).toBe("human_escalation");
    expect(response.riskLevel).toBe("high");
    expect(listTraces("test-session")[0].steps).toContain("进入故障报修模块");
  });

  it("售后报修先生成可编辑表单，不提前写入 CRM", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "准备售后报修",
      action: "prepare_service_ticket",
    });

    expect(response.ui?.kind).toBe("service_ticket_form");
    expect(listTraces("test-session")[0].steps).toContain("等待用户确认");
    expect(listTraces("test-session")[0].sources).toHaveLength(0);
  });

  it("确认报修后通过 CRM 创建售后工单", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "提交售后报修",
      action: "submit_service_ticket",
      serviceFormData: {
        serviceType: "维修服务",
        product: "悦享系列 LED 吸顶灯",
        purchaseChannel: "线下门店",
        faultDescription: "重启后仍然闪烁",
        contactPhone: "13800006821",
        serviceAddress: "上海市测试区测试路 18 号",
        preferredContactTime: "周六上午",
      },
    });

    expect(response.ui?.kind).toBe("service_ticket_success");
    expect(listTraces("test-session")[0].sources[0].sourceSystem).toBe("CRM");
  });

  it("工单查询在身份确认后返回 CRM 时间线", async () => {
    const beforeConfirm = await orchestrateMock({
      ...baseRequest,
      message: "帮我查一下报修进度",
    });
    expect(beforeConfirm.ui?.kind).toBe("identity_confirm");
    expect(listTraces("test-session")[0].sources).toHaveLength(0);

    clearTraces();
    const afterConfirm = await orchestrateMock({
      ...baseRequest,
      message: "查询最近售后工单",
      action: "confirm_service_identity",
    });
    expect(afterConfirm.ui?.kind).toBe("service_ticket");
    expect(listTraces("test-session")[0].sources[0].sourceSystem).toBe("CRM");
  });

  it("配网失败进入故障支持并记录知识主题", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "灯一直搜不到设备，配网失败了",
    });

    expect(response.intent).toBe("troubleshooting");
    expect(response.ui?.kind).toBe("troubleshooting");
    const trace = listTraces("test-session")[0];
    expect(trace.route.topic).toBe("smart_setup.setup_failure");
    expect(trace.sources[0].recordId).toBe("KB-SMART-SETUP-011");
  });

  it("上门安装预约生成安装服务草稿", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "我想预约师傅上门安装",
    });

    expect(response.intent).toBe("service_ticket_create");
    expect(response.ui?.kind).toBe("service_ticket_form");
    if (response.ui?.kind === "service_ticket_form") {
      expect(response.ui.form.serviceType).toBe("安装服务");
    }
    expect(listTraces("test-session")[0].route.topic).toBe("installation.appointment");
  });

  it("加盟和供应商问题只提供渠道指引，不调用售后工具", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "我想申请成为供应商",
    });

    expect(response.intent).toBe("other");
    expect(response.message).toContain("商务合作入口");
    expect(listTraces("test-session")[0].sources).toHaveLength(0);
    expect(listTraces("test-session")[0].route.action).toBe("provide_official_channel_guidance");
  });

  it("主动转人工和投诉争议进入不同人工路由", async () => {
    const requested = await orchestrateMock({ ...baseRequest, message: "我要转人工客服" });
    expect(requested.ui?.kind).toBe("human_handoff");
    expect(listTraces("test-session")[0].route.topic).toBe("handoff.requested");

    clearTraces();
    const dispute = await orchestrateMock({ ...baseRequest, message: "我要投诉，必须赔偿我" });
    expect(dispute.ui?.kind).toBe("human_handoff");
    expect(listTraces("test-session")[0].route.topic).toBe("handoff.dispute");
  });

  it("信息不足时只澄清，不读取业务数据", async () => {
    const response = await orchestrateMock({ ...baseRequest, message: "这个怎么处理" });
    expect(response.intent).toBe("clarification");
    expect(response.ui?.kind).toBe("clarification");
    expect(listTraces("test-session")[0].route.needsClarification).toBe(true);
    expect(listTraces("test-session")[0].sources).toHaveLength(0);
  });

  it("Mock Trace 记录完整应用调试上下文，但聊天响应不携带调试数据", async () => {
    const response = await orchestrateMock({
      ...baseRequest,
      message: "这款浴霸是单电机还是双电机？",
    });

    const trace = listTraces("test-session")[0];
    expect(trace.debug.recordLevel).toBe("application_full");
    expect(trace.debug.prompt.applicationSystemPrompt).toContain("意图路由器");
    expect(trace.debug.prompt.messages).toHaveLength(2);
    expect(trace.debug.classification.candidates[0].intent).toBe("knowledge_query");
    expect(trace.debug.classification.rules.some((rule) => rule.ruleId === "RULE-KB-HIDDEN-001" && rule.matched)).toBe(true);
    expect(trace.debug.modelOutput.raw).toContain("product.specification");
    expect(trace.debug.finalDecisionSummary).toContain("knowledge_query");
    expect(JSON.stringify(response)).not.toContain("applicationSystemPrompt");
    expect(JSON.stringify(response)).not.toContain("classification");
  });

  it("复杂写操作提供消费者可见的精简进度，不包含接口参数", () => {
    const plan = getPublicProgressPlan({
      message: "提交退换货申请",
      action: "submit_return",
      formData: {
        serviceType: "换货",
        product: "悦享系列 LED 吸顶灯",
        issueDescription: "灯罩破裂",
        contactPhone: "13800006821",
        pickupAddress: "上海市测试区测试路 18 号",
      },
    });

    expect(plan?.steps).toEqual(["校验申请信息", "创建退换货申请单", "同步售后处理队列"]);
    expect(JSON.stringify(plan)).not.toContain("contactPhone");
    expect(JSON.stringify(plan)).not.toContain("pickupAddress");
  });
});
