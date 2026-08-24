import type { ProductView, TraceSource } from "@/lib/contracts";

const product: ProductView = {
  name: "悦享系列 LED 吸顶灯",
  model: "MX960-D0.5×80",
  image:
    "https://images.unsplash.com/photo-1540932239986-30128078f3c5?auto=format&fit=crop&w=520&q=85",
  specs: ["建议空间 18–25㎡", "三档色温", "额定功率 80W"],
};

export async function getProductForLivingRoom(): Promise<{
  data: ProductView;
  source: TraceSource;
}> {
  return {
    data: product,
    source: {
      type: "business",
      sourceSystem: "PCMP",
      recordId: "SKU-MX960-D05-80",
      version: "2026.08",
      updatedAt: "2026-08-18T09:30:00+08:00",
    },
  };
}

export async function queryProductKnowledge(message: string): Promise<{
  data: { title: string; answer: string; items: string[]; topic: string };
  source: TraceSource;
}> {
  if (/浴霸|电机/.test(message)) {
    return {
      data: {
        title: "浴霸电机配置",
        answer: "不同浴霸型号的电机配置并不相同。当前 Mock 产品 MX6107D 为双电机设计，购买或报修前建议再核对机身铭牌型号。",
        items: ["示例型号：MX6107D", "电机配置：双电机", "最终以 PCMP 对应型号参数为准"],
        topic: "product.specification",
      },
      source: {
        type: "business",
        sourceSystem: "PCMP",
        recordId: "SKU-MX6107D",
        version: "2026.08",
        updatedAt: "2026-08-20T11:00:00+08:00",
      },
    };
  }

  if (/WIFI|WiFi|wifi|联网|智能/.test(message)) {
    return {
      data: {
        title: "智能连接能力",
        answer: "是否支持 WIFI 需要按具体型号确认。当前 Mock 产品“智控系列吸顶灯 ZC80”支持 2.4GHz WIFI，不支持仅 5GHz 的网络环境。",
        items: ["支持网络：2.4GHz WIFI", "配网方式：智享家 App", "不确定型号时可上传铭牌照片"],
        topic: "product.function_usage",
      },
      source: {
        type: "business",
        sourceSystem: "PCMP",
        recordId: "SKU-ZC80-WIFI",
        version: "2026.08",
        updatedAt: "2026-08-20T11:05:00+08:00",
      },
    };
  }

  return {
    data: {
      title: "产品规格与适用空间",
      answer: "20㎡左右的客厅可参考 18–25㎡适用范围的悦享系列吸顶灯，同时还要结合层高、墙面颜色和主要活动确认亮度。",
      items: product.specs,
      topic: "product.model_overview",
    },
    source: {
      type: "business",
      sourceSystem: "PCMP",
      recordId: "SKU-MX960-D05-80",
      version: "2026.08",
      updatedAt: "2026-08-18T09:30:00+08:00",
    },
  };
}
