"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep private error details out of the UI while retaining a server/client diagnostic hook.
    console.error("APPLICATION_BOUNDARY", error.digest ?? error.name);
  }, [error]);

  return (
    <main className="app-error" role="alert">
      <section>
        <span>服务暂时不可用</span>
        <h1>页面没有正常加载</h1>
        <p>你的业务操作不会因为页面错误而自动重试。可以重新加载，或返回消费者端重新开始。</p>
        <div>
          <button type="button" onClick={reset}>重新加载</button>
          <a href="/">返回消费者端</a>
        </div>
      </section>
    </main>
  );
}
