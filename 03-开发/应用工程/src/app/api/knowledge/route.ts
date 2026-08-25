import { NextResponse } from "next/server";

import type { KnowledgeArticleFields } from "@/lib/contracts";
import {
  createKnowledgeArticle,
  deactivateKnowledgeArticle,
  getKnowledgeArticle,
  listKnowledgeArticles,
  previewKnowledge,
  publishKnowledgeArticle,
  updateKnowledgeArticle,
} from "@/lib/knowledge-store";

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
    return NextResponse.json({
      results: previewKnowledge(body.query, typeof body.articleId === "string" ? body.articleId : undefined),
    });
  }

  if (body.action === "publish") {
    if (typeof body.id !== "string") {
      return NextResponse.json({ error: "缺少知识 ID" }, { status: 400 });
    }
    const current = getKnowledgeArticle(body.id);
    if (!current) return NextResponse.json({ error: "知识不存在" }, { status: 404 });
    const complete = [current.title, current.question, current.answer, current.productScope, current.source, current.maintainer]
      .every((value) => value.trim().length > 0) && current.answerItems.length > 0;
    if (!complete) {
      return NextResponse.json({ error: "发布前需补齐标题、用户问法、回答、要点、适用商品、来源和维护人" }, { status: 400 });
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

  return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
}

export async function PATCH(request: Request) {
  let body: { id?: string; article?: Partial<KnowledgeArticleFields> };
  try {
    body = await request.json() as { id?: string; article?: Partial<KnowledgeArticleFields> };
  } catch {
    return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  }
  if (!body.id || !body.article) {
    return NextResponse.json({ error: "缺少知识 ID 或编辑内容" }, { status: 400 });
  }
  const article = updateKnowledgeArticle(body.id, body.article);
  return article
    ? NextResponse.json({ article })
    : NextResponse.json({ error: "知识不存在" }, { status: 404 });
}
