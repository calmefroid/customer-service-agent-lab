import { throwForMockBehavior, throwIfModelAborted } from "./model-error";
import type {
  MockModelBehavior,
  ModelCallOptions,
  MultimodalInput,
  MultimodalModelAdapter,
  MultimodalObservationOutput,
} from "./types";

export interface MockMultimodalModelOptions {
  behavior?: Exclude<MockModelBehavior, "invalid_json">;
  requiresBusinessRouting?: boolean;
}

export class MockMultimodalModelAdapter implements MultimodalModelAdapter {
  readonly provider = "LocalMockModelAdapter";
  readonly model = "mock-multimodal-observer-v1";
  readonly mode = "mock" as const;
  callCount = 0;
  lastInput?: MultimodalInput;
  private readonly behavior: Exclude<MockModelBehavior, "invalid_json">;
  private readonly forcedBusinessRouting?: boolean;

  constructor(options: MockMultimodalModelOptions = {}) {
    this.behavior = options.behavior ?? "success";
    this.forcedBusinessRouting = options.requiresBusinessRouting;
  }

  async observe(input: MultimodalInput, options: ModelCallOptions = {}): Promise<MultimodalObservationOutput> {
    this.callCount += 1;
    this.lastInput = { ...input, attachment: { ...input.attachment }, history: input.history.map((message) => ({ ...message })) };
    throwIfModelAborted(options.signal);
    if (this.behavior !== "success") throwForMockBehavior(this.behavior);

    const damage = /破|碎|裂|损坏|换货|退货/.test(input.message) || input.module === "return";
    const plate = /铭牌|型号|标签/.test(input.message);
    const summary = damage
      ? "图片中可见灯罩边缘存在裂纹样可见现象"
      : plate
        ? "图片铭牌区域可见型号字符，Mock 识别结果为 LUM-36W"
        : "图片中可见一件灯具及其外观轮廓，未发现足以直接判断业务结果的信息";
    const uncertainties = damage
      ? ["无法仅凭图片判断破损原因、责任和退换资格"]
      : ["Mock 不读取真实像素，型号和状态需要用户复核"];
    const requiresBusinessRouting = this.forcedBusinessRouting
      ?? (damage || /申请|退货|换货|报修|查询|订单|物流|催办/.test(input.message));

    return {
      summary,
      uncertainties,
      responseText: `我能看到：${summary}。不确定项：${uncertainties.join("；")}。`,
      requiresBusinessRouting,
      provider: this.provider,
      model: this.model,
      mode: this.mode,
    };
  }
}
