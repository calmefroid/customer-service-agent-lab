"use client";

import {
  AlertTriangle,
  Archive,
  BookOpenCheck,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Eye,
  FilePenLine,
  Filter,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  KnowledgeRetrievalStatus,
  KnowledgeStatus,
  KnowledgeTopic,
} from "@/lib/contracts";
import type {
  KnowledgeManagedArticle,
  KnowledgeManagedFields,
  KnowledgePreviewResponse,
} from "@/lib/rag/types";

import styles from "./knowledge.module.css";

const topicLabels: Record<KnowledgeTopic, string> = {
  product: "产品知识",
  return: "退换与破损",
  safety: "用电安全",
  troubleshooting: "故障排查",
  smart_setup: "智能配网",
  warranty: "质保政策",
  installation: "安装指引",
  consumer_business: "消费者渠道",
};

const statusLabels: Record<KnowledgeStatus, string> = {
  draft: "草稿",
  published: "已发布",
  inactive: "已停用",
};

const retrievalLabels: Record<KnowledgeRetrievalStatus, string> = {
  hit: "命中",
  no_hit: "无有效知识",
  conflict: "知识冲突",
  expired: "时间窗无效",
};

function articleFields(article: KnowledgeManagedArticle): KnowledgeManagedFields {
  return {
    title: article.title,
    question: article.question,
    answer: article.answer,
    answerItems: [...article.answerItems],
    topic: article.topic,
    productScope: article.productScope,
    channelScope: article.channelScope,
    regionScope: article.regionScope,
    effectiveFrom: article.effectiveFrom,
    ...(article.effectiveTo ? { effectiveTo: article.effectiveTo } : {}),
    source: article.source,
    maintainer: article.maintainer,
    tags: [...article.tags],
  };
}

function dateTimeInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatTime(value?: string) {
  if (!value) return "尚未发布";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function KnowledgePage() {
  const [articles, setArticles] = useState<KnowledgeManagedArticle[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<KnowledgeManagedFields | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<KnowledgeStatus | "all">("all");
  const [topic, setTopic] = useState<KnowledgeTopic | "all">("all");
  const [previewQuery, setPreviewQuery] = useState("");
  const [preview, setPreview] = useState<KnowledgePreviewResponse | null>(null);
  const [previewFilters, setPreviewFilters] = useState({ productCategory: "", channel: "", region: "", effectiveAt: "" });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (preferredId?: string) => {
    setError("");
    try {
      const response = await fetch("/api/knowledge", { cache: "no-store" });
      if (!response.ok) throw new Error("加载失败");
      const data = await response.json() as { articles: KnowledgeManagedArticle[] };
      setArticles(data.articles);
      setSelectedId((current) => preferredId ?? (current || data.articles[0]?.id || ""));
    } catch {
      setError("知识库暂时无法读取，请确认本地服务仍在运行。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = articles.find((article) => article.id === selectedId);

  useEffect(() => {
    const nextSelected = articles.find((article) => article.id === selectedId);
    if (!nextSelected) return;
    setDraft(articleFields(nextSelected));
    setPreviewQuery(nextSelected.question);
    setPreview(null);
    setMessage("");
    setError("");
    // The editable form should reset only when the user selects another article.
    // Save/publish updates the selected record in-place without erasing the success message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return articles.filter((article) => {
      const text = [article.title, article.question, article.id, topicLabels[article.topic], ...article.tags].join(" ").toLowerCase();
      return (status === "all" || article.status === status)
        && (topic === "all" || article.topic === topic)
        && (!keyword || text.includes(keyword));
    });
  }, [articles, query, status, topic]);

  const dirty = Boolean(selected && draft && JSON.stringify(articleFields(selected)) !== JSON.stringify(draft));
  const publishedCount = articles.filter((article) => article.status === "published").length;
  const draftCount = articles.filter((article) => article.status === "draft" || article.hasUnpublishedChanges).length;
  const inactiveCount = articles.filter((article) => article.status === "inactive").length;

  function update<K extends keyof KnowledgeManagedFields>(key: K, value: KnowledgeManagedFields[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setMessage("");
    setError("");
  }

  async function save(): Promise<KnowledgeManagedArticle | undefined> {
    if (!selected || !draft) return undefined;
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, article: draft }),
      });
      const data = await response.json() as { article?: KnowledgeManagedArticle; error?: string };
      if (!response.ok || !data.article) throw new Error(data.error ?? "保存失败");
      setArticles((current) => current.map((article) => article.id === data.article?.id ? data.article : article));
      setMessage(data.article.status === "published" ? "工作副本已保存，发布前不会影响消费者回答。" : "草稿已保存。");
      return data.article;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
      return undefined;
    } finally {
      setWorking(false);
    }
  }

  async function createArticle() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      const data = await response.json() as { article: KnowledgeManagedArticle };
      if (!response.ok) throw new Error("新建失败");
      await load(data.article.id);
      setMessage("已创建知识草稿，请补充内容后预览并发布。");
    } catch {
      setError("新建知识失败，请稍后重试。");
    } finally {
      setWorking(false);
    }
  }

  async function runPreview() {
    if (!selected || !previewQuery.trim()) {
      setError("请输入用于测试召回的消费者问题。");
      return;
    }
    if (dirty && !await save()) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", query: previewQuery, articleId: selected.id, ...previewFilters }),
      });
      const data = await response.json() as KnowledgePreviewResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "预览失败");
      setPreview(data);
      setMessage("已使用当前工作副本完成召回预览；消费者线上问答仍只读取已发布版本。");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "预览失败");
    } finally {
      setWorking(false);
    }
  }

  async function publish() {
    if (!selected) return;
    if (dirty && !await save()) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", id: selected.id }),
      });
      const data = await response.json() as { article?: KnowledgeManagedArticle; error?: string };
      if (!response.ok || !data.article) throw new Error(data.error ?? "发布失败");
      await load(data.article.id);
      setMessage(`知识 ${data.article.version} 已发布，后续消费者问题将使用此版本。`);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "发布失败");
    } finally {
      setWorking(false);
    }
  }

  async function deactivate() {
    if (!selected || !window.confirm("停用后，消费者 RAG 将立即停止检索这条知识。确认继续吗？")) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate", id: selected.id }),
      });
      const data = await response.json() as { article?: KnowledgeManagedArticle; error?: string };
      if (!response.ok || !data.article) throw new Error(data.error ?? "停用失败");
      await load(data.article.id);
      setMessage("知识已停用，RAG 不会再使用该条目。");
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : "停用失败");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span><BookOpenCheck size={19} /></span>
          <div><strong>智享家客服控制台</strong><small>Knowledge Workspace · Mock</small></div>
        </div>
        <nav className={styles.headerActions}>
          <a href="/trace">执行 Trace</a>
          <a href="/" target="_blank" rel="noreferrer"><Bot size={14} />消费者端</a>
        </nav>
      </header>

      <div className={styles.content}>
        <section className={styles.hero}>
          <div><span className={styles.eyebrow}>客服知识库管理</span><h1>维护 Agent 真正可用的问答知识</h1><p>编辑工作副本、测试召回并显式发布。消费者端只读取已发布快照，知识编号与版本只在后台 Trace 留痕。</p></div>
          <button className={styles.createButton} disabled={working} onClick={() => void createArticle()}><Plus size={15} />新建知识</button>
        </section>

        <section className={styles.stats}>
          <div><span className={styles.publishedIcon}><CheckCircle2 size={18} /></span><strong>{publishedCount}</strong><small>已发布，可被 RAG 检索</small></div>
          <div><span className={styles.draftIcon}><FilePenLine size={18} /></span><strong>{draftCount}</strong><small>草稿或有待发布修改</small></div>
          <div><span className={styles.inactiveIcon}><Archive size={18} /></span><strong>{inactiveCount}</strong><small>已停用，不参与检索</small></div>
          <div><span><Sparkles size={18} /></span><strong>{articles.length}</strong><small>Mock 知识总数</small></div>
        </section>

        <section className={styles.toolbar}>
          <label className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、问法、标签或知识 ID" /></label>
          <label><Filter size={14} /><select value={status} onChange={(event) => setStatus(event.target.value as KnowledgeStatus | "all")}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><Filter size={14} /><select value={topic} onChange={(event) => setTopic(event.target.value as KnowledgeTopic | "all")}><option value="all">全部主题</option>{Object.entries(topicLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button onClick={() => void load(selectedId)}><RefreshCw size={14} />刷新</button>
        </section>

        {(error || message) && <div className={error ? styles.error : styles.notice}>{error || message}</div>}

        <div className={styles.workspace}>
          <aside className={styles.listPanel}>
            <div className={styles.panelTitle}><strong>知识条目</strong><span>{loading ? "加载中" : `${filtered.length} 条`}</span></div>
            {filtered.map((article) => (
              <button key={article.id} className={`${styles.articleRow} ${article.id === selectedId ? styles.selected : ""}`} onClick={() => setSelectedId(article.id)}>
                <div className={styles.rowTop}><span className={`${styles.status} ${styles[article.status]}`}>{statusLabels[article.status]}</span>{article.hasUnpublishedChanges && <em>有修改</em>}<time>{formatTime(article.updatedAt)}</time></div>
                <strong>{article.title}</strong><p>{article.question || "尚未填写用户问法"}</p>
                <div className={styles.rowMeta}><code>{article.id}</code><span>{topicLabels[article.topic]} · {article.version}</span><ChevronRight size={14} /></div>
              </button>
            ))}
            {!loading && filtered.length === 0 && <div className={styles.empty}>没有符合筛选条件的知识。</div>}
          </aside>

          <section className={styles.editorPanel}>
            {selected && draft ? (
              <div className={styles.editor}>
                <div className={styles.editorHead}>
                  <div><div className={styles.editorTags}><span className={`${styles.status} ${styles[selected.status]}`}>{statusLabels[selected.status]}</span><span>{selected.version}</span>{selected.hasUnpublishedChanges && <span className={styles.changed}>有待发布修改</span>}</div><h2>{draft.title || "未命名知识"}</h2><p>{selected.id} · 最近发布 {formatTime(selected.publishedAt)}</p></div>
                  <div className={styles.editorActions}><button disabled={working || !dirty} onClick={() => void save()}><Save size={14} />保存工作副本</button><button className={styles.publishButton} disabled={working} onClick={() => void publish()}><Send size={14} />发布</button></div>
                </div>

                <div className={styles.lifecycleNote}><CircleDashed size={15} /><div><strong>发布隔离已开启</strong><span>保存只更新工作副本；点击发布后才生成新版本并供消费者 RAG 使用。</span></div></div>

                <div className={styles.formGrid}>
                  <label className={styles.full}><span>知识标题 *</span><input value={draft.title} onChange={(event) => update("title", event.target.value)} /></label>
                  <label className={styles.full}><span>典型用户问法 *</span><textarea rows={2} value={draft.question} onChange={(event) => update("question", event.target.value)} /></label>
                  <label><span>问题库主题 *</span><select value={draft.topic} onChange={(event) => update("topic", event.target.value as KnowledgeTopic)}>{Object.entries(topicLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label><span>维护人 *</span><input value={draft.maintainer} onChange={(event) => update("maintainer", event.target.value)} /></label>
                  <label className={styles.full}><span>标准回答 *</span><textarea rows={4} value={draft.answer} onChange={(event) => update("answer", event.target.value)} /></label>
                  <label className={styles.full}><span>回答要点 *（每行一条）</span><textarea rows={4} value={draft.answerItems.join("\n")} onChange={(event) => update("answerItems", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} /></label>
                  <label><span>适用商品</span><input value={draft.productScope} onChange={(event) => update("productScope", event.target.value)} /></label>
                  <label><span>适用渠道</span><input value={draft.channelScope} onChange={(event) => update("channelScope", event.target.value)} /></label>
                  <label><span>适用地区</span><input value={draft.regionScope} onChange={(event) => update("regionScope", event.target.value)} /></label>
                  <label><span>知识来源 *</span><input value={draft.source} onChange={(event) => update("source", event.target.value)} /></label>
                  <label><span>生效时间 *</span><input type="datetime-local" value={dateTimeInput(draft.effectiveFrom)} onChange={(event) => update("effectiveFrom", event.target.value ? new Date(event.target.value).toISOString() : "")} /></label>
                  <label><span>失效时间（可选）</span><input type="datetime-local" value={dateTimeInput(draft.effectiveTo)} min={dateTimeInput(draft.effectiveFrom)} onChange={(event) => update("effectiveTo", event.target.value ? new Date(event.target.value).toISOString() : "")} /></label>
                  <label className={styles.full}><span>检索标签（逗号分隔）</span><input value={draft.tags.join("，")} onChange={(event) => update("tags", event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean))} /></label>
                </div>

                <section className={styles.previewSection}>
                  <div className={styles.sectionTitle}><div><Eye size={16} /><span>召回预览</span></div><small>预览可使用当前工作副本；线上消费者仍只使用 published 快照</small></div>
                  <div className={styles.previewBar}><input value={previewQuery} onChange={(event) => setPreviewQuery(event.target.value)} placeholder="输入一条消费者问题测试召回" /><button disabled={working} onClick={() => void runPreview()}>{working ? <LoaderCircle className={styles.spin} size={14} /> : <Sparkles size={14} />}测试召回</button></div>
                  <div className={styles.previewFilters}>
                    <label><span>产品 / 品类</span><input value={previewFilters.productCategory} onChange={(event) => setPreviewFilters((current) => ({ ...current, productCategory: event.target.value }))} placeholder="如：智能灯具" /></label>
                    <label><span>渠道</span><input value={previewFilters.channel} onChange={(event) => setPreviewFilters((current) => ({ ...current, channel: event.target.value }))} placeholder="如：线上商城" /></label>
                    <label><span>地区</span><input value={previewFilters.region} onChange={(event) => setPreviewFilters((current) => ({ ...current, region: event.target.value }))} placeholder="如：中国大陆" /></label>
                    <label><span>检索时间</span><input type="datetime-local" value={dateTimeInput(previewFilters.effectiveAt)} onChange={(event) => setPreviewFilters((current) => ({ ...current, effectiveAt: event.target.value ? new Date(event.target.value).toISOString() : "" }))} /></label>
                  </div>
                  {preview && <div className={`${styles.retrievalSummary} ${styles[preview.retrieval.status]}`}>
                    <div><strong>{retrievalLabels[preview.retrieval.status]}</strong><span>{preview.retrieval.selectedArticleIds.length ? `采用 ${preview.retrieval.selectedArticleIds.join("、")}` : "不自动采用知识"}</span></div>
                    <code>{preview.retrieval.requestId}</code>
                    {preview.retrieval.conflicts.map((conflict) => <p key={conflict.articleIds.join("-")}><AlertTriangle size={13} />{conflict.reason}</p>)}
                  </div>}
                  {preview?.candidates.length ? <div className={styles.previewResults}>{preview.candidates.map((result, index) => <article key={result.articleId} className={`${result.selectedDraft ? styles.previewSelected : ""} ${result.adopted ? styles.previewAdopted : ""}`}><span>#{index + 1}</span><div><strong>{result.title}</strong><p>{result.excerpt}</p><small>{topicLabels[result.topic]} · {statusLabels[result.status]} · {result.version}{result.selectedDraft ? " · 当前工作副本" : ""}</small><div className={styles.scoreBreakdown}>标题 {Math.round(result.fieldScores.title * 100)} · 问法 {Math.round(result.fieldScores.question * 100)} · 回答 {Math.round(result.fieldScores.answer * 100)} · 标签 {Math.round(result.fieldScores.tags * 100)} · 范围 {Math.round(result.fieldScores.scope * 100)}</div>{result.adoptionReason && <div className={styles.adoptionReason}>采用：{result.adoptionReason}</div>}{result.filterReasons.map((reason) => <div className={styles.filterReason} key={reason}>过滤：{reason}</div>)}</div><em>{Math.round(result.score * 100)}%</em></article>)}</div> : <div className={styles.previewEmpty}><Eye size={20} /><span>{preview ? "没有达到阈值的候选知识；不会生成业务结论。" : "输入消费者问法，检查候选知识、版本、过滤原因与确定性分数。"}</span></div>}
                </section>

                <div className={styles.dangerZone}><div><Archive size={15} /><span><strong>停用知识</strong><small>停用后消费者 RAG 立即停止使用，Trace 中历史版本仍保留。</small></span></div><button disabled={working || selected.status === "inactive"} onClick={() => void deactivate()}>{selected.status === "inactive" ? "已停用" : "停用此知识"}</button></div>
              </div>
            ) : <div className={styles.editorEmpty}><BookOpenCheck size={30} /><strong>选择一条知识开始维护</strong><span>也可以新建草稿，完成预览后再发布。</span></div>}
          </section>
        </div>
      </div>
    </main>
  );
}
