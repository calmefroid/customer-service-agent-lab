import type {
  KnowledgeArticle,
  KnowledgeArticleFields,
  KnowledgePreviewResult,
  KnowledgeTopic,
} from "@/lib/contracts";

type StoredKnowledgeArticle = Omit<KnowledgeArticle, "hasUnpublishedChanges"> & {
  publishedSnapshot?: KnowledgeArticleFields;
};

declare global {
  // eslint-disable-next-line no-var
  var customerServiceKnowledgeStore: StoredKnowledgeArticle[] | undefined;
}

const seedFields: Array<KnowledgeArticleFields & { id: string; version: string; updatedAt: string }> = [
  {
    id: "KB-PRODUCT-LIVINGROOM-012",
    version: "V3.2",
    updatedAt: "2026-08-15T16:00:00+08:00",
    title: "客厅灯具选型与产品参数说明",
    question: "20 平米客厅怎么选灯？灯具型号、功能和参数在哪里查询？",
    answer: "产品型号、结构化参数和功能以 PCMP 产品主数据为准；知识库补充适用空间、使用条件和客服解释口径。",
    answerItems: ["20㎡左右客厅可参考 18–25㎡适用范围", "结合层高、墙面颜色和主要活动确认亮度", "具体型号参数以 PCMP 对应记录为准"],
    topic: "product",
    productScope: "吸顶灯、浴霸、智能灯具",
    channelScope: "全部消费者渠道",
    regionScope: "中国大陆",
    source: "PCMP 产品说明与客服审核口径",
    maintainer: "产品知识运营",
    tags: ["型号", "参数", "选型", "产品功能"],
  },
  {
    id: "KB-AFTERSALE-DAMAGE-006",
    version: "V2.6",
    updatedAt: "2026-08-12T11:20:00+08:00",
    title: "签收破损退换货处理",
    question: "商品签收后发现破损、碎裂，怎么申请退换？",
    answer: "签收后发现外观破损，可上传商品与包装照片发起售后申请；照片只用于记录可见问题，不自动判定责任或赔偿。",
    answerItems: ["上传商品破损处和外包装照片", "补充商品、问题、联系人和取件地址", "确认申请草稿后进入人工审核"],
    topic: "return",
    productScope: "全部灯具商品",
    channelScope: "线上商城、线下门店",
    regionScope: "中国大陆",
    source: "售后退换货处理规范",
    maintainer: "售后政策运营",
    tags: ["破损", "换货", "退货", "签收"],
  },
  {
    id: "KB-SAFETY-ELECTRIC-004",
    version: "V4.1",
    updatedAt: "2026-08-19T14:00:00+08:00",
    title: "灯具电气安全紧急处理",
    question: "灯具冒烟、烧焦、有火花或异常发热怎么办？",
    answer: "出现冒烟、烧焦味、火花、触电或异常发热时，应立即断开对应电源并停止使用，不要触碰或自行拆解，系统应优先升级人工安全专席。",
    answerItems: ["立即断开对应电源并停止使用", "不要触碰、拆机或再次通电测试", "优先升级安全专席；出现明火时远离现场并联系紧急服务"],
    topic: "safety",
    productScope: "全部用电产品",
    channelScope: "全部消费者渠道",
    regionScope: "中国大陆",
    source: "用电安全红线规则",
    maintainer: "质量与安全团队",
    tags: ["冒烟", "烧焦", "火花", "漏电", "异常发热"],
  },
  {
    id: "KB-AFTERSALE-TROUBLESHOOT-009",
    version: "V2.3",
    updatedAt: "2026-08-18T10:30:00+08:00",
    title: "常见灯具故障安全排查",
    question: "灯具闪烁、不亮、遥控异常或有异响怎么办？",
    answer: "普通故障先进行不拆机的安全排查；若仍未恢复，可整理故障现象并创建售后报修单。",
    answerItems: ["关闭灯具等待 30 秒后重新开启", "确认同一空间其他照明或电器是否正常", "禁止拆机或接触线路；仍未恢复时申请报修"],
    topic: "troubleshooting",
    productScope: "吸顶灯、智能灯具",
    channelScope: "全部消费者渠道",
    regionScope: "中国大陆",
    source: "售后故障排查手册",
    maintainer: "售后技术支持",
    tags: ["闪烁", "不亮", "遥控", "异响", "报修"],
  },
  {
    id: "KB-SMART-SETUP-011",
    version: "V1.8",
    updatedAt: "2026-08-20T09:10:00+08:00",
    title: "智能灯具配网失败处理",
    question: "智能灯具连不上 WIFI、搜不到设备或绑定失败怎么办？",
    answer: "配网失败时先确认使用 2.4GHz 网络、设备处于配网状态，并让手机靠近设备重试；不要拆机检查无线模块。",
    answerItems: ["确认手机连接 2.4GHz WIFI", "让设备重新进入配网状态后靠近重试", "仍失败时记录型号与 App 提示并联系售后"],
    topic: "smart_setup",
    productScope: "支持联网的智能灯具",
    channelScope: "全部消费者渠道",
    regionScope: "中国大陆",
    source: "智享家 App 配网手册",
    maintainer: "智能产品支持",
    tags: ["配网", "WIFI", "绑定", "搜不到设备"],
  },
  {
    id: "KB-AFTERSALE-WARRANTY-003",
    version: "V3.0",
    updatedAt: "2026-08-17T15:40:00+08:00",
    title: "质保与售后服务通用说明",
    question: "产品质保多久？维修收费吗？过保以后怎么处理？",
    answer: "质保期限和服务范围需结合具体型号、购买渠道与有效凭证确认；个案收费、保修例外和责任问题由人工审核。",
    answerItems: ["质保期限按具体型号和购买渠道确认", "收费和保修例外以人工审核结果为准", "需要实际处理时可继续创建售后工单"],
    topic: "warranty",
    productScope: "全部灯具商品",
    channelScope: "线上商城、线下门店",
    regionScope: "中国大陆",
    source: "售后质保政策",
    maintainer: "售后政策运营",
    tags: ["质保", "保修", "收费", "过保"],
  },
  {
    id: "KB-INSTALL-GUIDE-007",
    version: "V2.1",
    updatedAt: "2026-08-16T13:30:00+08:00",
    title: "灯具安全安装与拆卸边界",
    question: "灯具怎么安装、拆卸或接线？有没有安装视频？",
    answer: "操作前必须断开对应电源并核对具体型号说明；涉及接线、拆线或裸露线路时不要自行操作，应预约专业人员。",
    answerItems: ["操作前断开对应电源", "查看与具体型号匹配的安装说明", "接线、拆线或裸露线路必须由专业人员处理"],
    topic: "installation",
    productScope: "全部需要安装的灯具",
    channelScope: "全部消费者渠道",
    regionScope: "中国大陆",
    source: "产品安装安全规范",
    maintainer: "安装服务运营",
    tags: ["安装", "拆卸", "接线", "安装视频"],
  },
  {
    id: "KB-CONSUMER-CHANNEL-005",
    version: "V1.5",
    updatedAt: "2026-08-14T10:00:00+08:00",
    title: "消费者官方服务渠道",
    question: "官方门店在哪里？怎么验真？客服电话是多少？",
    answer: "消费者可通过官方门店查询、产品验真和客服渠道获得服务；加盟、供应商或市场合作应进入对应业务渠道。",
    answerItems: ["门店、验真和客服电话仅使用官方渠道", "图片不能直接完成产品真伪认定", "电商售后继续分流到退换或故障报修"],
    topic: "consumer_business",
    productScope: "全部产品",
    channelScope: "全部消费者渠道",
    regionScope: "中国大陆",
    source: "消费者渠道指引",
    maintainer: "客服运营",
    tags: ["门店", "验真", "客服电话", "购买渠道"],
  },
];

function cloneFields(article: KnowledgeArticleFields): KnowledgeArticleFields {
  return { ...article, answerItems: [...article.answerItems], tags: [...article.tags] };
}

function createSeedStore(): StoredKnowledgeArticle[] {
  return seedFields.map(({ id, version, updatedAt, ...fields }) => ({
    id,
    version,
    updatedAt,
    publishedAt: updatedAt,
    status: "published",
    ...cloneFields(fields),
    publishedSnapshot: cloneFields(fields),
  }));
}

function store(): StoredKnowledgeArticle[] {
  if (!globalThis.customerServiceKnowledgeStore) {
    globalThis.customerServiceKnowledgeStore = createSeedStore();
  }
  return globalThis.customerServiceKnowledgeStore;
}

function fieldsOf(article: StoredKnowledgeArticle): KnowledgeArticleFields {
  return {
    title: article.title,
    question: article.question,
    answer: article.answer,
    answerItems: [...article.answerItems],
    topic: article.topic,
    productScope: article.productScope,
    channelScope: article.channelScope,
    regionScope: article.regionScope,
    source: article.source,
    maintainer: article.maintainer,
    tags: [...article.tags],
  };
}

function hasChanges(article: StoredKnowledgeArticle): boolean {
  if (!article.publishedSnapshot) return true;
  return JSON.stringify(fieldsOf(article)) !== JSON.stringify(article.publishedSnapshot);
}

function toPublic(article: StoredKnowledgeArticle): KnowledgeArticle {
  const { publishedSnapshot: _publishedSnapshot, ...rest } = article;
  return { ...rest, answerItems: [...article.answerItems], tags: [...article.tags], hasUnpublishedChanges: hasChanges(article) };
}

function nextVersion(version: string): string {
  const match = version.match(/^V(\d+)\.(\d+)$/);
  if (!match) return "V1.0";
  return `V${match[1]}.${Number(match[2]) + 1}`;
}

export function listKnowledgeArticles(): KnowledgeArticle[] {
  return store()
    .map(toPublic)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getKnowledgeArticle(id: string): KnowledgeArticle | undefined {
  const article = store().find((item) => item.id === id);
  return article ? toPublic(article) : undefined;
}

export function createKnowledgeArticle(input?: Partial<KnowledgeArticleFields>): KnowledgeArticle {
  const now = new Date().toISOString();
  const article: StoredKnowledgeArticle = {
    id: `KB-DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    status: "draft",
    version: "V0.1",
    updatedAt: now,
    title: input?.title ?? "未命名知识",
    question: input?.question ?? "",
    answer: input?.answer ?? "",
    answerItems: input?.answerItems ?? [],
    topic: input?.topic ?? "troubleshooting",
    productScope: input?.productScope ?? "全部灯具商品",
    channelScope: input?.channelScope ?? "全部消费者渠道",
    regionScope: input?.regionScope ?? "中国大陆",
    source: input?.source ?? "客服人工维护",
    maintainer: input?.maintainer ?? "客服运营",
    tags: input?.tags ?? [],
  };
  store().push(article);
  return toPublic(article);
}

export function updateKnowledgeArticle(id: string, input: Partial<KnowledgeArticleFields>): KnowledgeArticle | undefined {
  const article = store().find((item) => item.id === id);
  if (!article) return undefined;
  Object.assign(article, input);
  if (input.answerItems) article.answerItems = [...input.answerItems];
  if (input.tags) article.tags = [...input.tags];
  article.updatedAt = new Date().toISOString();
  return toPublic(article);
}

export function publishKnowledgeArticle(id: string): KnowledgeArticle | undefined {
  const article = store().find((item) => item.id === id);
  if (!article) return undefined;
  const now = new Date().toISOString();
  article.status = "published";
  article.version = article.publishedSnapshot ? nextVersion(article.version) : "V1.0";
  article.publishedSnapshot = cloneFields(fieldsOf(article));
  article.publishedAt = now;
  article.updatedAt = now;
  return toPublic(article);
}

export function deactivateKnowledgeArticle(id: string): KnowledgeArticle | undefined {
  const article = store().find((item) => item.id === id);
  if (!article) return undefined;
  article.status = "inactive";
  article.updatedAt = new Date().toISOString();
  return toPublic(article);
}

export function getPublishedKnowledgeByTopic(topic: KnowledgeTopic): KnowledgeArticle | undefined {
  const article = store()
    .filter((item) => item.status === "published" && item.topic === topic && item.publishedSnapshot)
    .sort((a, b) => new Date(b.publishedAt ?? b.updatedAt).getTime() - new Date(a.publishedAt ?? a.updatedAt).getTime())[0];
  if (!article?.publishedSnapshot) return undefined;
  return toPublic({ ...article, ...cloneFields(article.publishedSnapshot) });
}

function scoreText(query: string, article: StoredKnowledgeArticle): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return 0;
  const text = [article.title, article.question, article.answer, article.topic, ...article.answerItems, ...article.tags].join(" ").toLowerCase();
  const tokens = new Set([
    normalized,
    ...normalized.split(/[\s，。！？、,.!?]+/).filter((token) => token.length > 1),
    ...Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2)),
  ]);
  const matches = [...tokens].filter((token) => text.includes(token));
  return Math.min(0.99, Number((0.18 + matches.length * 0.11).toFixed(2)));
}

export function previewKnowledge(query: string, selectedArticleId?: string): KnowledgePreviewResult[] {
  return store()
    .map((article) => ({ article, score: scoreText(query, article) + (article.id === selectedArticleId ? 0.08 : 0) }))
    .filter(({ score, article }) => score > 0.18 || article.id === selectedArticleId)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ article, score }) => ({
      articleId: article.id,
      title: article.title,
      topic: article.topic,
      status: article.status,
      version: article.version,
      score: Math.min(0.99, Number(score.toFixed(2))),
      excerpt: article.answer.slice(0, 120),
      selectedDraft: article.id === selectedArticleId,
    }));
}

export function resetKnowledgeStore(): void {
  globalThis.customerServiceKnowledgeStore = createSeedStore();
}
