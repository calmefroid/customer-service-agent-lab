import type { ProductMasterAdapter } from "@/lib/domain/business";
import { businessStore } from "@/lib/stores/business/business-store";
import { executeMock } from "@/lib/adapters/mock-adapter-utils";

export class PcmpMockAdapter implements ProductMasterAdapter {
  getProduct(sku: string, options?: Parameters<ProductMasterAdapter["getProduct"]>[1]) {
    return executeMock("PCMP", options, () => {
      const product = businessStore.getProduct(sku);
      return product ? { data: product, records: [product] } : null;
    });
  }

  searchProducts(query: string, options?: Parameters<ProductMasterAdapter["searchProducts"]>[1]) {
    return executeMock("PCMP", options, () => {
      const normalized = query.trim().toLowerCase();
      const products = businessStore.listProducts().filter((item) =>
        [item.sku, item.name, item.model, item.category, ...item.specs]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      );
      return products.length > 0 ? { data: products, records: products } : null;
    });
  }
}

export const pcmpMockAdapter = new PcmpMockAdapter();
