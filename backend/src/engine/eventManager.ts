/**
 * Event-Driven Architecture Layer — MarketEventManager
 *
 * Central event bus for all market events. Pure event-driven, no periodic loops.
 *
 * Flow: matching.ts / liquidityManager.ts / scheduler.ts
 *       ──emit──► MarketEventManager.emit()
 *                    ├── WebSocket subscriber (index.ts) broadcasts to clients
 *                    ├── AlgoEngine subscriber (bot reactions — future)
 *                    └── Analytics / logger subscribers (future)
 */

// ── Event Types ───────────────────────────────────────────────────────────────

export enum MarketEventType {
  ORDER_PLACED       = 'ORDER_PLACED',
  ORDER_CANCELLED    = 'ORDER_CANCELLED',
  ORDER_MATCHED      = 'ORDER_MATCHED',
  TRADE_EXECUTED     = 'TRADE_EXECUTED',
  ORDERBOOK_UPDATED  = 'ORDERBOOK_UPDATED',
  PRICE_CHANGED      = 'PRICE_CHANGED',
  FOMO_TRIGGERED     = 'FOMO_TRIGGERED',
  WALL_DETECTED       = 'WALL_DETECTED',
  LIQUIDITY_CHANGED  = 'LIQUIDITY_CHANGED',
  MARKET_STATUS      = 'MARKET_STATUS',
}

// ── Compatibility type alias (used by sibling subagents) ─────────────────────

export type GameEventType = MarketEventType;
export interface GameEvent {
  type: MarketEventType;
  data: Record<string, any>;
  timestamp: string;
}

// ── Payload Interfaces ────────────────────────────────────────────────────────

export interface BaseMarketEvent {
  type: MarketEventType;
  stockId: string;
  timestamp: string;
}

export interface OrderPlacedEvent extends BaseMarketEvent {
  type: MarketEventType.ORDER_PLACED;
  orderId: string;
  side: 'BID' | 'OFFER';
  price: number;
  quantity: number;
  orderType: string;
}

export interface OrderCancelledEvent extends BaseMarketEvent {
  type: MarketEventType.ORDER_CANCELLED;
  orderId: string;
  side: 'BID' | 'OFFER';
  reason: string;
}

export interface OrderMatchedEvent extends BaseMarketEvent {
  type: MarketEventType.ORDER_MATCHED;
  buyOrderId: string;
  sellOrderId: string;
  matchPrice: number;
  matchQuantity: number;
}

export interface TradeExecutedEvent extends BaseMarketEvent {
  type: MarketEventType.TRADE_EXECUTED;
  price: number;
  quantity: number;
  tradeType: string; // 'MATCH' | 'HAKA' | 'HAKI'
}

export interface OrderbookUpdatedEvent extends BaseMarketEvent {
  type: MarketEventType.ORDERBOOK_UPDATED;
}

export interface PriceChangedEvent extends BaseMarketEvent {
  type: MarketEventType.PRICE_CHANGED;
  price: number;
  previousPrice: number;
}

export interface FomoTriggeredEvent extends BaseMarketEvent {
  type: MarketEventType.FOMO_TRIGGERED;
  price: number;
  velocity: number;
  direction: 'UP' | 'DOWN';
}

export interface WallDetectedEvent extends BaseMarketEvent {
  type: MarketEventType.WALL_DETECTED;
  side: 'BID' | 'OFFER';
  price: number;
  totalQuantity: number;
}

export interface LiquidityChangedEvent extends BaseMarketEvent {
  type: MarketEventType.LIQUIDITY_CHANGED;
  mode: 'HIGH' | 'MEDIUM' | 'LOW';
  previousMode: 'HIGH' | 'MEDIUM' | 'LOW';
  currentMode: 'HIGH' | 'MEDIUM' | 'LOW';
  config: Record<string, unknown>;
  bidDepth: number;
  offerDepth: number;
}

export interface MarketStatusEvent extends BaseMarketEvent {
  type: MarketEventType.MARKET_STATUS;
  status: string;
}

export type MarketEvent =
  | OrderPlacedEvent
  | OrderCancelledEvent
  | OrderMatchedEvent
  | TradeExecutedEvent
  | OrderbookUpdatedEvent
  | PriceChangedEvent
  | FomoTriggeredEvent
  | WallDetectedEvent
  | LiquidityChangedEvent
  | MarketStatusEvent;

// ── Subscriber Types ──────────────────────────────────────────────────────────

export type EventSubscriber = (event: MarketEvent) => void | Promise<void>;

interface Subscription {
  id: number;
  eventTypes: MarketEventType[];
  stockIds: string[];
  callback: EventSubscriber;
}

// ── MarketEventManager ────────────────────────────────────────────────────────

class MarketEventManager {
  private subscriptions: Map<number, Subscription> = new Map();
  private nextId = 1;

  /**
   * Subscribe to market events.
   * Returns a subscription ID — pass to unsubscribe() to remove.
   */
  subscribe(
    callback: EventSubscriber,
    options: { eventTypes?: MarketEventType[]; stockIds?: string[] } = {}
  ): number {
    const id = this.nextId++;
    this.subscriptions.set(id, {
      id,
      eventTypes: options.eventTypes ?? [],
      stockIds: options.stockIds ?? [],
      callback,
    });
    return id;
  }

  /** Remove subscription by ID */
  unsubscribe(id: number): void {
    this.subscriptions.delete(id);
  }

  /** Remove all subscriptions */
  clear(): void {
    this.subscriptions.clear();
  }

  /** Count of active subscribers */
  get subscriberCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Emit an event to all matching subscribers.
   * Fire-and-forget — errors in one subscriber don't block others.
   */
  emit(event: MarketEvent): void {
    for (const sub of this.subscriptions.values()) {
      // Filter by event type
      if (sub.eventTypes.length > 0 && !sub.eventTypes.includes(event.type)) {
        continue;
      }
      // Filter by stock
      if (sub.stockIds.length > 0 && !sub.stockIds.includes(event.stockId)) {
        continue;
      }
      // Invoke subscriber, catching sync errors
      try {
        const result = sub.callback(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error(`[EventManager] Subscriber ${sub.id} async error:`, err);
          });
        }
      } catch (err) {
        console.error(`[EventManager] Subscriber ${sub.id} sync error:`, err);
      }
    }
  }
}

// ── Singleton instance ────────────────────────────────────────────────────────

export const marketEvents = new MarketEventManager();

// ── Legacy API (backward-compat with modules using string-based emit) ─────────

export const eventManager = {
  /** String-based emit: builds a MarketEvent and dispatches */
  emit(type: string, data: Record<string, any>): void {
    const event: MarketEvent = {
      type: type as MarketEventType,
      stockId: data.stockId ?? '*',
      timestamp: new Date().toISOString(),
      ...data,
    } as MarketEvent;
    marketEvents.emit(event);
  },
  /** Pass-through to MarketEventManager methods */
  subscribe: marketEvents.subscribe.bind(marketEvents),
  unsubscribe: marketEvents.unsubscribe.bind(marketEvents),
  clear: marketEvents.clear.bind(marketEvents),
  get subscriberCount() { return marketEvents.subscriberCount; },
};

// ── Thin Socket.IO wrappers (backward-compat with sibling modules) ────────────

/**
 * Emit an event into a specific stock room via Socket.IO.
 * Also fires it through the event bus so subscribers (e.g. index.ts WS bridge)
 * can broadcast consistently.
 */
export function emitToStockRoom(stockId: string, type: GameEventType, data: Record<string, any>): void {
  const payload: MarketEvent = {
    type,
    stockId,
    timestamp: new Date().toISOString(),
    ...data,
  } as MarketEvent;
  marketEvents.emit(payload);
}

/**
 * Emit a global event to all connected clients via Socket.IO.
 */
export function emitGlobalEvent(type: GameEventType, data: Record<string, any>): void {
  // Lazy import to avoid circular dependency
  try {
    const { io } = require('../index');
    io.emit(type, data);
  } catch {
    // io not available during tests — silently skip
  }
}
