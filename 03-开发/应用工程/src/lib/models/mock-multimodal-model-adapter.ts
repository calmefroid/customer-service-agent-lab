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

    const signal = `${input.attachment.name} ${input.message}`.toLowerCase();
    const blurry = /模糊|看不清|无法看清|blur|blurry|unreadable|out[-_ ]?of[-_ ]?focus/.test(signal);
    const damage = !blurry && /破损|破了|碎了|裂纹|裂了|损坏|damage|damaged|broken|crack/.test(signal);
    const nameplate = !blurry && /铭牌|型号|标签|nameplate|model[-_ ]?plate/.test(signal);
    const authenticity = /真伪|真假|正品|假货|authentic/.test(signal);
    const explicitBusinessAction = /申请|退货|换货|报修|查订单|订单|物流|催办|转人工|投诉/.test(input.message);
    const safetySignal = /冒烟|烧焦|触电|火花|异常发热|明显过热|漏电|起火/.test(input.message);

    let summary: string;
    let uncertainties: string[];
    let responseText: string;
    if (blurry) {
      summary = "图片中的铭牌区域较模糊，型号字符无法确认";
      uncertainties = ["当前图片无法确认具体型号，也不能据此判断真伪或业务资格"];
      responseText = "这张图片里的铭牌比较模糊，我目前无法确认具体型号。请在光线充足、镜头对焦后正对铭牌补拍一张。";
    } else if (damage) {
      summary = "图片中可见灯罩边缘存在裂纹样可见现象";
      uncertainties = ["无法仅凭图片判断破损原因、责任和退换资格"];
      responseText = "图片中可见灯罩边缘有裂纹样现象；原因、责任和退换资格仍需后续流程核验。";
    } else if (nameplate) {
      summary = "图片铭牌区域可见型号字符，识别结果为 LUM-36W";
      uncertainties = ["仅能读取当前清晰可见的文字，不能据此判断产品真伪"];
      responseText = "铭牌上可见的型号为 LUM-36W；该结果仅来自图片中的可见文字，不能作为真伪判断。";
    } else {
      summary = "图片中可见一件灯具及其外观轮廓，未发现足以直接判断业务结果的信息";
      uncertainties = ["无法仅凭图片判断真伪、责任、退换资格或赔偿结果"];
      responseText = authenticity
        ? "我可以描述图片中的可见信息，但不能仅凭图片判断产品真伪。请通过官方验真渠道进一步核验。"
        : "我能看到一件灯具及其外观轮廓，但当前图片不足以确认具体型号或业务结论。";
    }
    const requiresBusinessRouting = this.forcedBusinessRouting
      ?? (damage || explicitBusinessAction || safetySignal);

    return {
      summary,
      uncertainties,
      responseText,
      requiresBusinessRouting,
      provider: this.provider,
      model: this.model,
      mode: this.mode,
    };
  }
}
