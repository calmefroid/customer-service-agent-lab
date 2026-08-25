import { NextResponse } from "next/server";

import {
  createKnowledgeArticle,
  deactivateKnowledgeArticle,
  getKnowledgeArticle,
  listKnowledgeArticles,
  previewKnowledge,
  publishKnowledgeArticle,
  resetKnowledgeStore,
  updateKnowledgeArticle,
} from "@/lib/knowledge-store";
import type { KnowledgeManagedFields, KnowledgeSearchFilters } from "@/lib/rag/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ articles: listKnowledgeArticles() });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  }

  if (body.action === "create") {
    return NextResponse.json({ article: createKnowledgeArticle() }, { status: 201 });
  }

  if (body.action === "preview") {
    if (typeof body.query !== "string" || !body.query.trim()) {
      return NextResponse.json({ error: "请输入用于预览召回的问题" }, { status: 400 });
    }
    const filters: KnowledgeSearchFilters = {
      ...(typeof body.productCategory === "string" && body.productCategory.trim() ? { productCategory: body.productCategory.trim() } : {}),
      ...(typeof body.channel === "string" && body.channel.trim() ? { channel: body.channel.trim() } : {}),
      ...(typeof body.region === "string" && body.region.trim() ? { region: body.region.trim() } : {}),
      ...(typeof body.effectiveAt === "string" && body.effectiveAt.trim() ? { effectiveAt: body.effectiveAt } : {}),
    };
    if (filters.effectiveAt && Number.isNaN(new Date(filters.effectiveAt).getTime())) {
      return NextResponse.json({ error: "检索时间不是有效日期" }, { status: 400 });
    }
    const preview = previewKnowledge(body.query, typeof body.articleId === "string" ? body.articleId : undefined, filters);
    return NextResponse.json(preview);
  }

  if (body.action === "publish") {
    if (typeof body.id !== "string") {
      return NextResponse.json({ error: "缺少知识 ID" }, { status: 400 });
    }
    const current = getKnowledgeArticle(body.id);
    if (!current) return NextResponse.json({ error: "知识不存在" }, { status: 404 });
    const complete = [current.title, current.question, current.answer, current.productScope, current.channelScope, current.regionScope, current.effectiveFrom, current.source, current.maintainer]
      .every((value) => value.trim().length > 0) && current.answerItems.length > 0;
    if (!complete) {
      return NextResponse.json({ error: "发布前需补齐标题、问法、回答、要点、适用范围、生效时间、来源和维护人" }, { status: 400 });
    }
    if (!validWindow(current.effectiveFrom, current.effectiveTo)) {
      return NextResponse.json({ error: "失效时间必须晚于生效时间" }, { status: 400 });
    }
    return NextResponse.json({ article: publishKnowledgeArticle(body.id) });
  }

  if (body.action === "deactivate") {
    if (typeof body.id !== "string") {
      return NextResponse.json({ error: "缺少知识 ID" }, { status: 400 });
    }
    const article = deactivateKnowledgeArticle(body.id);
    return article
      ? NextResponse.json({ article })
      : NextResponse.json({ error: "知识不存在" }, { status: 404 });
  }

  if (body.action === "reset") {
    resetKnowledgeStore();
    return NextResponse.json({ articles: listKnowledgeArticles() });
  }

  return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
}

export async function PATCH(request: Request) {
  let body: { id?: string; article?: Partial<KnowledgeManagedFields> };
  try {
    body = await request.json() as { id?: string; article?: Partial<KnowledgeManagedFields> };
  } catch {
    return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  }
  if (!body.id || !body.article) {
    return NextResponse.json({ error: "缺少知识 ID 或编辑内容" }, { status: 400 });
  }
  if (body.article.effectiveFrom && Number.isNaN(new Date(body.article.effectiveFrom).getTime())) {
    return NextResponse.json({ error: "生效时间不是有效日期" }, { status: 400 });
  }
  if (body.article.effectiveTo && Number.isNaN(new Date(body.article.effectiveTo).getTime())) {
    return NextResponse.json({ error: "失效时间不是有效日期" }, { status: 400 });
  }
  const current = getKnowledgeArticle(body.id);
  if (current && !validWindow(body.article.effectiveFrom ?? current.effectiveFrom, body.article.effectiveTo ?? current.effectiveTo)) {
    return NextResponse.json({ error: "失效时间必须晚于生效时间" }, { status: 400 });
  }
  const article = updateKnowledgeArticle(body.id, body.article);
  return article
    ? NextResponse.json({ article })
    : NextResponse.json({ error: "知识不存在" }, { status: 404 });
}

function validWindow(effectiveFrom: string, effectiveTo?: string): boolean {
  const from = new Date(effectiveFrom).getTime();
  const to = effectiveTo ? new Date(effectiveTo).getTime() : Number.POSITIVE_INFINITY;
  return Number.isFinite(from) && to > from;
}
