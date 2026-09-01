import {
  initialFulfillments,
  initialOrders,
  initialProducts,
  initialServiceTickets,
  initialShipments,
} from "@/lib/mock-data/business-fixtures";
import type {
  BusinessRecord,
  FulfillmentRecord,
  HumanHandoffRecord,
  LogisticsUrgeRecord,
  OrderChangeRecord,
  OrderCancelRecord,
  OrderRecord,
  ProductRecord,
  ReturnExchangeRecord,
  ServiceTicketRecord,
  ShipmentRecord,
} from "@/lib/domain/business";
import { confirmationStore } from "@/lib/stores/business/confirmation-store";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type WritableRecord =
  | OrderChangeRecord
  | OrderCancelRecord
  | LogisticsUrgeRecord
  | ReturnExchangeRecord
  | ServiceTicketRecord;

export class BusinessStore {
  private products: ProductRecord[] = [];
  private orders: OrderRecord[] = [];
  private fulfillments: FulfillmentRecord[] = [];
  private shipments: ShipmentRecord[] = [];
  private orderChanges: OrderChangeRecord[] = [];
  private orderCancellations: OrderCancelRecord[] = [];
  private logisticsUrges: LogisticsUrgeRecord[] = [];
  private returnExchanges: ReturnExchangeRecord[] = [];
  private serviceTickets: ServiceTicketRecord[] = [];
  private humanHandoffs: HumanHandoffRecord[] = [];
  private sequences = new Map<string, number>();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.products = clone(initialProducts);
    this.orders = clone(initialOrders);
    this.fulfillments = clone(initialFulfillments);
    this.shipments = clone(initialShipments);
    this.orderChanges = [];
    this.orderCancellations = [];
    this.logisticsUrges = [];
    this.returnExchanges = [];
    this.serviceTickets = clone(initialServiceTickets);
    this.humanHandoffs = [];
    this.sequences.clear();
    confirmationStore.reset();
  }

  nextId(prefix: string): string {
    const next = (this.sequences.get(prefix) ?? 0) + 1;
    this.sequences.set(prefix, next);
    return `${prefix}${String(next).padStart(4, "0")}`;
  }

  getProduct(sku: string): ProductRecord | undefined {
    return clone(this.products.find((item) => item.sku === sku));
  }

  listProducts(): ProductRecord[] {
    return clone(this.products);
  }

  getOrder(orderId: string): OrderRecord | undefined {
    return clone(this.orders.find((item) => item.orderId === orderId));
  }

  listOrders(customerId?: string): OrderRecord[] {
    return clone(customerId ? this.orders.filter((item) => item.customerId === customerId) : this.orders);
  }

  getFulfillment(orderId: string): FulfillmentRecord | undefined {
    return clone(this.fulfillments.find((item) => item.orderId === orderId));
  }

  listFulfillments(): FulfillmentRecord[] {
    return clone(this.fulfillments);
  }

  getShipment(orderId: string): ShipmentRecord | undefined {
    return clone(this.shipments.find((item) => item.orderId === orderId));
  }

  listShipments(): ShipmentRecord[] {
    return clone(this.shipments);
  }

  addOrderChange(record: OrderChangeRecord): OrderChangeRecord {
    return this.addIdempotent(this.orderChanges, record);
  }

  listOrderChanges(): OrderChangeRecord[] {
    return clone(this.orderChanges);
  }

  addOrderCancellation(record: OrderCancelRecord): OrderCancelRecord {
    return this.addIdempotent(this.orderCancellations, record);
  }

  listOrderCancellations(): OrderCancelRecord[] {
    return clone(this.orderCancellations);
  }

  addLogisticsUrge(record: LogisticsUrgeRecord): LogisticsUrgeRecord {
    return this.addIdempotent(this.logisticsUrges, record);
  }

  listLogisticsUrges(): LogisticsUrgeRecord[] {
    return clone(this.logisticsUrges);
  }

  addReturnExchange(record: ReturnExchangeRecord): ReturnExchangeRecord {
    return this.addIdempotent(this.returnExchanges, record);
  }

  listReturnExchanges(): ReturnExchangeRecord[] {
    return clone(this.returnExchanges);
  }

  addServiceTicket(record: ServiceTicketRecord): ServiceTicketRecord {
    return this.addIdempotent(this.serviceTickets, record);
  }

  getServiceTicket(ticketNo: string): ServiceTicketRecord | undefined {
    return clone(this.serviceTickets.find((item) => item.ticketNo === ticketNo));
  }

  listServiceTickets(customerId?: string): ServiceTicketRecord[] {
    return clone(customerId ? this.serviceTickets.filter((item) => item.customerId === customerId) : this.serviceTickets);
  }

  addHumanHandoff(record: HumanHandoffRecord): HumanHandoffRecord {
    const existing = this.humanHandoffs.find((item) => item.sessionId === record.sessionId && item.reason === record.reason);
    if (existing) return clone(existing);
    this.humanHandoffs.push(clone(record));
    return clone(record);
  }

  listHumanHandoffs(): HumanHandoffRecord[] {
    return clone(this.humanHandoffs);
  }

  getRecord(recordId: string): BusinessRecord | undefined {
    const groups: BusinessRecord[][] = [
      this.products,
      this.orders,
      this.fulfillments,
      this.shipments,
      this.orderChanges,
      this.orderCancellations,
      this.logisticsUrges,
      this.returnExchanges,
      this.serviceTickets,
      this.humanHandoffs,
    ];
    return clone(groups.flat().find((item) => item.recordId === recordId));
  }

  private addIdempotent<T extends WritableRecord>(records: T[], record: T): T {
    const existing = records.find((item) => item.idempotencyKey === record.idempotencyKey);
    if (existing) return clone(existing);
    records.push(clone(record));
    return clone(record);
  }
}

export const businessStore = new BusinessStore();
