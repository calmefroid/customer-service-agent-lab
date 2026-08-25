import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // 工作区已有统一 AGENTS.md，避免 Next.js 在项目目录重复生成规则文件。
  agentRules: false,
};

export default nextConfig;
