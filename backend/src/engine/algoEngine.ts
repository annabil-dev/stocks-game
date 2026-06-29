/**
 * AlgoEngine — 4 Bot Personas
 *
 * 1. MARKET MAKER   — fills spread gaps, maintains liquidity
 * 2. SWEEPER (HAKA/HAKI) — detects walls, sweeps aggressively
 * 3. SPOOFER/LAYERING — places fake walls, cancels after X seconds
 * 4. FOMO TRIGGER   — large trade → all bots aggressive for 5 seconds
 *
 * Subscribes to EventManager events instead of polling.
 * Maintains active_orders registry for cancellation.
 */

import { prisma } from '../db';
import { placeOrder } from './matching';
import { getTickSize } from './tickSize';
import {
  marketEvents,
  MarketEventType,
  type MarketEvent,
  type TradeExecutedEvent,
  type OrderMatchedEvent,
  type OrderbookUpdatedEvent,
  type FomoTriggeredEvent,
} from './eventManager';
import { getLiquidityConfig, getLiquidityMode, type LiquidityMode, type LiquidityConfig } from './liquidityManager';

// ── Helpers ──────────────────────────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function snapToTick(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

function clampPrice(price: number, lastPrice: number, araPrice?: number, arbPrice?: number): number {
  const cap = araPrice && araPrice > 0 ? araPrice : Math.floor(lastPrice * 1.25);
  const floor = arbPrice && arbPrice > 0 ? arbPrice : Math.ceil(lastPrice * 0.75);
  return Math.min(cap, Math.max(floor, price));
}

// ── Aggression Modes ─────────────────────────────────────────────────────────

/** Split a large quantity into 2-5 smaller sub-orders with random weights.
 *  Returns array of { weight (0-1), splitIndex }. spreadInTicks offsets the price. */
function splitOrder(totalLots: number): { splitLots: number; spreadTicks: number }[] {
  const n = randomInt(2, Math.min(5, Math.max(2, Math.floor(totalLots / 50))));
  const base = Math.floor(totalLots / n);
  const remainder = totalLots % n;
  const result: { splitLots: number; spreadTicks: number }[] = [];
  for (let i = 0; i < n; i++) {
    const lots = base + (i < remainder ? 1 : 0);
    // spread 0-2 ticks away from base price
    const spreadTicks = i === 0 ? 0 : randomInt(0, 2);
    if (lots > 0) result.push({ splitLots: lots, spreadTicks });
  }
  return result;
}

type AggressionMode = 'FOMO' | 'AGGRESSIVE' | 'NORMAL' | 'SLEEPY';

const REACTION_TIMES: Record<AggressionMode, [number, number]> = {
  FOMO:       [10, 100],      // 10–100 ms
  AGGRESSIVE: [100, 500],     // 100–500 ms
  NORMAL:     [500, 2000],    // 500ms–2s
  SLEEPY:     [2000, 10000],  // 2–10s
};

const SLEEPY_CHANCE = 0.05;

// ── Liquidity Mode Overlay ───────────────────────────────────────────────────

/** Scale quantity ranges by the current liquidity mode config */
function liquidityQtyMultiplier(): number {
  const cfg = getLiquidityConfig();
  // Normalize: MEDIUM = 1.0, HIGH ≈ 2.5, LOW ≈ 0.4
  // Using mmMinQty/mmMaxQty vs MEDIUM defaults (1/5 lots)
  return (cfg.mmMinQty + cfg.mmMaxQty) / (1 + 5);
}

/** Activity probability gate: LOW mode causes more skips */
function liquidityActivityGate(): boolean {
  const mode = getLiquidityMode();
  if (mode === 'HIGH') return true;  // always active
  if (mode === 'MEDIUM') return true;
  return Math.random() < 0.4;  // 60% chance to skip in LOW
}

/** Spread threshold overlay: liquidity mode tightens/widens */
function liquiditySpreadMultiplier(): number {
  const cfg = getLiquidityConfig();
  // MEDIUM spread = 2 ticks, so ratio is cfg.spreadThreshold / 2
  return cfg.spreadThreshold / 2;
}

// ── Active Orders Registry ───────────────────────────────────────────────────

interface ActiveOrder {
  orderId: string;
  userId: string;
  stockId: string;
  side: 'BID' | 'OFFER';
  price: number;
  quantity: number;
  remainingQuantity: number;
  createdAt: number; // Date.now() ms
  persona: PersonaType;
  isSpoof: boolean;
  spoofDeadline?: number;
}

type PersonaType = 'MARKET_MAKER' | 'SWEEPER' | 'SPOOFER' | 'FOMO_TRIGGER';

class ActiveOrdersRegistry {
  private orders: Map<string, ActiveOrder> = new Map();

  register(order: ActiveOrder): void {
    this.orders.set(order.orderId, order);
  }

  remove(orderId: string): void {
    this.orders.delete(orderId);
  }

  getForStock(stockId: string): ActiveOrder[] {
    return [...this.orders.values()].filter(o => o.stockId === stockId);
  }

  getForPersona(persona: PersonaType): ActiveOrder[] {
    return [...this.orders.values()].filter(o => o.persona === persona);
  }

  getAll(): ActiveOrder[] {
    return [...this.orders.values()];
  }

  get size(): number {
    return this.orders.size;
  }
}

// ── Engine State ─────────────────────────────────────────────────────────────

let systemBotUserId: string | null = null;

const activeOrders = new ActiveOrdersRegistry();

/** Current aggression mode per stock (shared across personas) */
const stockAggression: Map<string, AggressionMode> = new Map();

/** FOMO cooldown timers per stock */
const fomoTimers: Map<string, NodeJS.Timeout> = new Map();

/** Subscription IDs for cleanup */
const subscriptionIds: number[] = [];

/** Main loop flag */
let engineRunning = false;

// ── Aggression Mode Logic ────────────────────────────────────────────────────

function getAggression(stockId: string): AggressionMode {
  return stockAggression.get(stockId) || 'NORMAL';
}

function setAggression(stockId: string, mode: AggressionMode): void {
  stockAggression.set(stockId, mode);
}

function getReactionDelay(stockId: string): number {
  const mode = getAggression(stockId);
  const [min, max] = REACTION_TIMES[mode];
  return randomInt(min, max);
}

// ── System Bot User Setup ────────────────────────────────────────────────────

const SYSTEM_ALGO_EMAIL = 'systembot.algo@bursasimulasi.internal';

async function ensureSystemBot(): Promise<string> {
  if (systemBotUserId) return systemBotUserId;

  let user = await prisma.user.findUnique({ where: { email: SYSTEM_ALGO_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: SYSTEM_ALGO_EMAIL,
        passwordHash: 'SYSTEM_ALGO',
        cashBalance: 10_000_000_000_000, // 10T IDR
      },
    });
    console.log('[AlgoEngine] Created system algo bot:', SYSTEM_ALGO_EMAIL);
  }
  systemBotUserId = user.id;
  return user.id;
}

// ── Order Placement Helper ───────────────────────────────────────────────────

interface BotOrderParams {
  stockId: string;
  side: 'BID' | 'OFFER';
  price: number;
  quantity: number;
  persona: PersonaType;
  type?: 'LIMIT' | 'HAKA' | 'HAKI';
  isSpoof?: boolean;
  spoofDurationMs?: number;
}

async function botPlaceOrder(params: BotOrderParams): Promise<string | null> {
  const userId = await ensureSystemBot();
  const { stockId, side, price, quantity, persona, type: orderType, isSpoof, spoofDurationMs } = params;

  if (price <= 0 || quantity <= 0 || quantity < 100) return null;

  // Ensure bot has portfolio for OFFER side
  if (side === 'OFFER') {
    const portfolio = await prisma.portfolio.findUnique({
      where: { userId_stockId: { userId, stockId } },
    });
    if (!portfolio || portfolio.quantity < quantity) {
      await prisma.portfolio.upsert({
        where: { userId_stockId: { userId, stockId } },
        update: { quantity: { increment: quantity * 5 } },
        create: { userId, stockId, quantity: quantity * 5, avgPrice: price },
      });
    }
  }

  try {
    const result = await placeOrder({
      userId,
      stockId,
      side,
      price,
      quantity,
      type: orderType || 'LIMIT',
    });

    const orderId = result.incomingOrder.id;

    // Register in active orders
    activeOrders.register({
      orderId,
      userId,
      stockId,
      side,
      price,
      quantity,
      remainingQuantity: result.executedQty < quantity ? quantity - result.executedQty : quantity,
      createdAt: Date.now(),
      persona,
      isSpoof: isSpoof || false,
      spoofDeadline: isSpoof ? Date.now() + (spoofDurationMs || 3000) : undefined,
    });

    return orderId;
  } catch {
    return null;
  }
}

// ── Cancel Order ─────────────────────────────────────────────────────────────

async function cancelBotOrder(orderId: string): Promise<void> {
  const order = activeOrders.getAll().find(o => o.orderId === orderId);
  if (!order) return;

  try {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', remainingQuantity: 0 },
    });

    // Refund locked cash if BID
    if (order.side === 'BID') {
      const refund = order.remainingQuantity * order.price;
      await prisma.user.update({
        where: { id: order.userId },
        data: { cashBalance: { increment: refund } },
      });
    } else {
      // Refund locked stock
      await prisma.portfolio.upsert({
        where: { userId_stockId: { userId: order.userId, stockId: order.stockId } },
        update: { quantity: { increment: order.remainingQuantity } },
        create: {
          userId: order.userId,
          stockId: order.stockId,
          quantity: order.remainingQuantity,
          avgPrice: order.price,
        },
      });
    }

    activeOrders.remove(orderId);
    console.log(`[AlgoEngine] Cancelled order ${orderId} (${order.persona})`);
  } catch (err) {
    console.error(`[AlgoEngine] Cancel error for ${orderId}:`, err);
  }
}

// ── Market Data Helpers ──────────────────────────────────────────────────────

interface BookLevel {
  price: number;
  quantity: number;
}

async function getOrderbook(stockId: string): Promise<{
  bids: BookLevel[]; offers: BookLevel[];
  bestBid: number; bestOffer: number; spread: number; lastPrice: number;
  araPrice: number; arbPrice: number;
}> {
  const stock = await prisma.stock.findUnique({ where: { id: stockId } });
  if (!stock) return { bids: [], offers: [], bestBid: 0, bestOffer: 0, spread: 0, lastPrice: 0, araPrice: 0, arbPrice: 0 };

  const lastPrice = stock.lastPrice;

  const [bids, offers] = await Promise.all([
    prisma.order.findMany({
      where: { stockId, side: 'BID', status: { in: ['OPEN', 'PARTIAL'] } },
      orderBy: [{ price: 'desc' }, { createdAt: 'asc' }],
      take: 20,
    }),
    prisma.order.findMany({
      where: { stockId, side: 'OFFER', status: { in: ['OPEN', 'PARTIAL'] } },
      orderBy: [{ price: 'asc' }, { createdAt: 'asc' }],
      take: 20,
    }),
  ]);

  // Aggregate to levels
  const bidLevels: Map<number, number> = new Map();
  for (const o of bids) {
    const p = Number(o.price);
    bidLevels.set(p, (bidLevels.get(p) || 0) + o.remainingQuantity);
  }

  const offerLevels: Map<number, number> = new Map();
  for (const o of offers) {
    const p = Number(o.price);
    offerLevels.set(p, (offerLevels.get(p) || 0) + o.remainingQuantity);
  }

  const bidArr = Array.from(bidLevels.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([price, quantity]) => ({ price, quantity }));
  const offerArr = Array.from(offerLevels.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([price, quantity]) => ({ price, quantity }));

  const bestBid = bidArr[0]?.price || 0;
  const bestOffer = offerArr[0]?.price || 0;
  const spread = bestOffer > 0 && bestBid > 0 ? bestOffer - bestBid : 0;

  return { bids: bidArr, offers: offerArr, bestBid, bestOffer, spread, lastPrice, araPrice: stock.araPrice, arbPrice: stock.arbPrice };
}

/** Detect walls: price levels with volume >= threshold */
function detectWalls(levels: BookLevel[], threshold: number): BookLevel[] {
  return levels.filter(l => l.quantity >= threshold);
}

// ── PERSONA 1: MARKET MAKER ─────────────────────────────────────────────────

function marketMakerSpreadThreshold(aggression: AggressionMode, tick: number): number {
  switch (aggression) {
    case 'FOMO':       return tick * 1;
    case 'AGGRESSIVE': return tick * 1;
    case 'NORMAL':     return tick * 2;
    case 'SLEEPY':     return tick * 3;
  }
}

async function marketMakerReact(stockId: string): Promise<void> {
  const book = await getOrderbook(stockId);
  if (book.lastPrice <= 0) return;

  // Liquidity gate: skip in LOW mode
  if (!liquidityActivityGate()) return;

  const tick = getTickSize(book.lastPrice);
  const aggression = getAggression(stockId);
  const liqMul = liquiditySpreadMultiplier();
  const spreadThreshold = Math.round(marketMakerSpreadThreshold(aggression, tick) * liqMul);

  // Only act if spread is wider than threshold
  if (book.spread < spreadThreshold && book.bestBid > 0 && book.bestOffer > 0) return;

  // Quantity based on aggression × liquidity multiplier
  // Minimum ~100M IDR per entry (split across 2-4 sub-orders for realism)
  const qtyMap: Record<AggressionMode, [number, number]> = {
    FOMO:       [60000, 150000],
    AGGRESSIVE: [30000, 80000],
    NORMAL:     [12000, 50000],
    SLEEPY:     [6000, 25000],
  };
  const [qMin, qMax] = qtyMap[aggression];
  const liqQtyMul = liquidityQtyMultiplier();
  const adjustedMin = Math.max(100, Math.round(qMin * liqQtyMul));
  const adjustedMax = Math.round(qMax * liqQtyMul);
  const totalLots = randomInt(Math.ceil(adjustedMin / 100), Math.floor(adjustedMax / 100));
  const splits = splitOrder(totalLots);

  const mid = book.bestBid > 0 && book.bestOffer > 0
    ? Math.round((book.bestBid + book.bestOffer) / 2)
    : book.lastPrice;

  const delay = getReactionDelay(stockId);

  // Place split orders on each side
  for (const s of splits) {
    const qty = s.splitLots * 100;
    if (qty < 100) continue;

    // Bid: base price minus (1 + spreadTicks) ticks
    const bidPrice = clampPrice(snapToTick(mid - tick * (1 + s.spreadTicks), tick), book.lastPrice, book.araPrice, book.arbPrice);
    if (bidPrice > 0) {
      setTimeout(() => {
        botPlaceOrder({ stockId, side: 'BID', price: bidPrice, quantity: qty, persona: 'MARKET_MAKER' });
      }, delay + s.spreadTicks * 50);
    }

    // Offer: base price plus (1 + spreadTicks) ticks
    const offerPrice = clampPrice(snapToTick(mid + tick * (1 + s.spreadTicks), tick), book.lastPrice, book.araPrice, book.arbPrice);
    if (offerPrice > 0) {
      setTimeout(() => {
        botPlaceOrder({ stockId, side: 'OFFER', price: offerPrice, quantity: qty, persona: 'MARKET_MAKER' });
      }, delay + s.spreadTicks * 50);
    }
  }
}

/** Market Maker reacts to TRADE_EXECUTED by providing liquidity on opposite side */
async function marketMakerOnTrade(stockId: string, tradePrice: number, tradeQty: number, tradeType: string): Promise<void> {
  const book = await getOrderbook(stockId);
  if (book.lastPrice <= 0) return;

  const tick = getTickSize(book.lastPrice);
  const aggression = getAggression(stockId);

  // If trade was HAKA (buy), provide offer; if HAKI (sell), provide bid
  const isBuyTrade = tradeType === 'HAKA';
  const side = isBuyTrade ? 'OFFER' : 'BID';

  const qtyMap: Record<AggressionMode, [number, number]> = {
    FOMO:       [15000, 40000],
    AGGRESSIVE: [8000, 25000],
    NORMAL:     [4000, 15000],
    SLEEPY:     [2000, 8000],
  };
  const [qMin, qMax] = qtyMap[aggression];
  const lots = randomInt(Math.ceil(qMin / 100), Math.floor(qMax / 100));
  const orderQty = lots * 100;

  let orderPrice: number;
  if (side === 'BID') {
    orderPrice = clampPrice(snapToTick(tradePrice - tick, tick), book.lastPrice, book.araPrice, book.arbPrice);
  } else {
    orderPrice = clampPrice(snapToTick(tradePrice + tick, tick), book.lastPrice, book.araPrice, book.arbPrice);
  }

  if (orderPrice <= 0) return;

  const delay = getReactionDelay(stockId);
  setTimeout(() => {
    botPlaceOrder({ stockId, side, price: orderPrice, quantity: orderQty, persona: 'MARKET_MAKER' });
  }, delay);
}

// ── PERSONA 2: SWEEPER (HAKA/HAKI) ─────────────────────────────────────────

function wallThreshold(aggression: AggressionMode): number {
  switch (aggression) {
    case 'FOMO':       return 5000;
    case 'AGGRESSIVE': return 8000;
    case 'NORMAL':     return 12000;
    case 'SLEEPY':     return 20000;
  }
}

function sweepProbability(aggression: AggressionMode): number {
  switch (aggression) {
    case 'FOMO':       return 0.90;
    case 'AGGRESSIVE': return 0.70;
    case 'NORMAL':     return 0.35;
    case 'SLEEPY':     return 0.10;
  }
}

async function sweeperReact(stockId: string): Promise<void> {
  const book = await getOrderbook(stockId);
  if (book.lastPrice <= 0) return;

  const tick = getTickSize(book.lastPrice);
  const aggression = getAggression(stockId);
  const wallThresh = wallThreshold(aggression);
  const sweepProb = sweepProbability(aggression);

  if (Math.random() > sweepProb) return;

  const bidWalls = detectWalls(book.bids, wallThresh);
  const offerWalls = detectWalls(book.offers, wallThresh);

  // Sweep quantity: 10000–250000 shares (100–2500 lots)
  const sweepQtyMap: Record<AggressionMode, [number, number]> = {
    FOMO:       [80000, 250000],
    AGGRESSIVE: [40000, 150000],
    NORMAL:     [15000, 80000],
    SLEEPY:     [10000, 40000],
  };
  const [sMin, sMax] = sweepQtyMap[aggression];
  const lots = randomInt(Math.ceil(sMin / 100), Math.floor(sMax / 100));
  const sweepQty = lots * 100;

  // Wall on OFFER side → sweep (buy through it)
  if (offerWalls.length > 0) {
    const targetWall = offerWalls[0];
    if (aggression === 'SLEEPY' || aggression === 'NORMAL') {
      if (book.offers.indexOf(offerWalls[0]) > 1) return;
    }

    const delay = getReactionDelay(stockId);
    setTimeout(() => {
      const sweepPrice = clampPrice(targetWall.price, book.lastPrice, book.araPrice, book.arbPrice);
      if (sweepPrice > 0) {
        botPlaceOrder({ stockId, side: 'BID', price: sweepPrice, quantity: sweepQty, persona: 'SWEEPER', type: 'HAKA' });
      }
    }, delay);
  }

  // Wall on BID side → sweep (sell through it)
  if (bidWalls.length > 0) {
    const targetWall = bidWalls[0];
    if (aggression === 'SLEEPY' || aggression === 'NORMAL') {
      if (book.bids.indexOf(bidWalls[0]) > 1) return;
    }

    const delay = getReactionDelay(stockId);
    setTimeout(() => {
      const sweepPrice = clampPrice(targetWall.price, book.lastPrice, book.araPrice, book.arbPrice);
      if (sweepPrice > 0) {
        botPlaceOrder({ stockId, side: 'OFFER', price: sweepPrice, quantity: sweepQty, persona: 'SWEEPER', type: 'HAKI' });
      }
    }, delay);
  }
}

// ── PERSONA 3: SPOOFER/LAYERING ──────────────────────────────────────────────

function spoofDistance(aggression: AggressionMode): number {
  switch (aggression) {
    case 'FOMO':       return 3;
    case 'AGGRESSIVE': return 4;
    case 'NORMAL':     return 5;
    case 'SLEEPY':     return 7;
  }
}

function spoofCancelDuration(aggression: AggressionMode): number {
  switch (aggression) {
    case 'FOMO':       return 1000;
    case 'AGGRESSIVE': return 2000;
    case 'NORMAL':     return 4000;
    case 'SLEEPY':     return 8000;
  }
}

async function spooferReact(stockId: string): Promise<void> {
  const book = await getOrderbook(stockId);
  if (book.lastPrice <= 0 || book.bestBid <= 0 || book.bestOffer <= 0) return;

  const tick = getTickSize(book.lastPrice);
  const aggression = getAggression(stockId);
  const distance = spoofDistance(aggression);
  const cancelMs = spoofCancelDuration(aggression);

  // Fake quantity: 20000–300000 shares (200–3000 lots)
  const fakeQtyMap: Record<AggressionMode, [number, number]> = {
    FOMO:       [100000, 300000],
    AGGRESSIVE: [70000, 220000],
    NORMAL:     [40000, 100000],
    SLEEPY:     [20000, 70000],
  };
  const [fMin, fMax] = fakeQtyMap[aggression];
  const lots = randomInt(Math.ceil(fMin / 100), Math.floor(fMax / 100));
  const fakeQty = lots * 100;

  const spoofBidPrice = clampPrice(snapToTick(book.bestBid - (tick * distance), tick), book.lastPrice, book.araPrice, book.arbPrice);
  const spoofOfferPrice = clampPrice(snapToTick(book.bestOffer + (tick * distance), tick), book.lastPrice, book.araPrice, book.arbPrice);

  const delay = getReactionDelay(stockId);

  if (spoofBidPrice > 0 && Math.random() < 0.7) {
    setTimeout(async () => {
      const orderId = await botPlaceOrder({
        stockId, side: 'BID', price: spoofBidPrice, quantity: fakeQty,
        persona: 'SPOOFER', isSpoof: true, spoofDurationMs: cancelMs,
      });
      if (orderId) {
        setTimeout(() => cancelBotOrder(orderId), cancelMs);
      }
    }, delay);
  }

  if (spoofOfferPrice > 0 && Math.random() < 0.7) {
    setTimeout(async () => {
      const orderId = await botPlaceOrder({
        stockId, side: 'OFFER', price: spoofOfferPrice, quantity: fakeQty,
        persona: 'SPOOFER', isSpoof: true, spoofDurationMs: cancelMs,
      });
      if (orderId) {
        setTimeout(() => cancelBotOrder(orderId), cancelMs);
      }
    }, delay);
  }
}

// ── PERSONA 4: FOMO TRIGGER ──────────────────────────────────────────────────

const FOMO_THRESHOLD = 5000; // 5,000 shares (50 lots) — lowered for more frequent FOMO triggers
const FOMO_DURATION_MS = 5000;

function triggerFomo(stockId: string, triggerQty: number): void {
  const prevMode = getAggression(stockId);
  if (prevMode === 'FOMO') return;

  console.log(`[AlgoEngine:FOMO] Triggered for ${stockId}! Trade qty=${triggerQty} → FOMO mode for 5s`);
  setAggression(stockId, 'FOMO');

  // Emit FOMO event via MarketEvents bus
  marketEvents.emit({
    type: MarketEventType.FOMO_TRIGGERED,
    stockId,
    timestamp: new Date().toISOString(),
    price: 0, // will be filled by subscribers from last price
    velocity: triggerQty / FOMO_THRESHOLD,
    direction: 'UP',
  });

  const existingTimer = fomoTimers.get(stockId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    setAggression(stockId, 'AGGRESSIVE');
    console.log(`[AlgoEngine:FOMO] ${stockId} FOMO expired → AGGRESSIVE`);

    setTimeout(() => {
      if (getAggression(stockId) === 'AGGRESSIVE') {
        setAggression(stockId, 'NORMAL');
        console.log(`[AlgoEngine] ${stockId} decayed AGGRESSIVE → NORMAL`);
      }
    }, 5000);
  }, FOMO_DURATION_MS);

  fomoTimers.set(stockId, timer);
}

async function fomoTriggerOnTrade(stockId: string, quantity: number): Promise<void> {
  if (quantity >= FOMO_THRESHOLD) {
    triggerFomo(stockId, quantity);
  }
}

// ── Evaluate & Cancel Stale Orders ───────────────────────────────────────────

let lastEvaluateRun = 0;
async function evaluateOrders(): Promise<void> {
  if (!engineRunning) return;

  // Throttle: max once per 100ms
  const now = Date.now();
  if (now - lastEvaluateRun < 100) return;
  lastEvaluateRun = now;

  // Hard cap: if registry is too large, prune oldest excess orders immediately
  const MAX_ACTIVE = 100;
  const allOrders = activeOrders.getAll();
  if (allOrders.length > MAX_ACTIVE) {
    const sortedByAge = [...allOrders].sort((a, b) => a.createdAt - b.createdAt);
    const excess = sortedByAge.slice(0, allOrders.length - MAX_ACTIVE);
    for (const order of excess) {
      try {
        await cancelBotOrder(order.orderId);
      } catch { /* ignore */ }
    }
    return; // let next tick finish cleanup
  }

  const orders = allOrders; // bounded

  // Batch fetch: one query for all stocks, one query for all order statuses
  const stockIds = Array.from(new Set(orders.map(o => o.stockId)));
  const orderIds = orders.map(o => o.orderId);

  const [stocks, dbOrders] = await Promise.all([
    prisma.stock.findMany({ where: { id: { in: stockIds } } }),
    prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, status: true } }),
  ]);

  const stockMap = new Map(stocks.map(s => [s.id, s]));
  const dbOrderMap = new Map(dbOrders.map(o => [o.id, o]));

  for (const order of orders) {
    try {
      if (order.isSpoof) continue;

      const maxAge: Record<PersonaType, number> = {
        MARKET_MAKER: 300000,
        SWEEPER: 120000,
        SPOOFER: 60000,
        FOMO_TRIGGER: 60000,
      };
      const age = now - order.createdAt;
      if (age > maxAge[order.persona]) {
        await cancelBotOrder(order.orderId);
        continue;
      }

      const stock = stockMap.get(order.stockId);
      if (!stock) continue;
      const tick = getTickSize(stock.lastPrice);
      const tickDistance = Math.abs(order.price - stock.lastPrice) / tick;
      if (tickDistance > 5) {
        await cancelBotOrder(order.orderId);
        continue;
      }

      const marketPrice = stock.lastPrice;
      let expectedProfit: number;
      if (order.side === 'BID') {
        expectedProfit = (marketPrice - order.price) / order.price;
      } else {
        expectedProfit = (order.price - marketPrice) / marketPrice;
      }
      if (expectedProfit < -0.01) {
        await cancelBotOrder(order.orderId);
        continue;
      }

      const dbOrder = dbOrderMap.get(order.orderId);
      if (!dbOrder || dbOrder.status === 'FILLED' || dbOrder.status === 'CANCELLED' || dbOrder.status === 'REJECTED') {
        activeOrders.remove(order.orderId);
        continue;
      }
    } catch {
      activeOrders.remove(order.orderId);
    }
  }
}

// ── Event Subscriptions ──────────────────────────────────────────────────────

function subscribeEvents(): void {
  // TRADE_EXECUTED → Market Maker provides liquidity, FOMO checks
  const lastTradeUpdate: Record<string, number> = {};
  const tradeSub = marketEvents.subscribe(async (event: MarketEvent) => {
    if (!engineRunning) return;
    if (event.type !== MarketEventType.TRADE_EXECUTED) return;
    const now = Date.now();
    const key = (event as TradeExecutedEvent).stockId;
    // throttle per‑stock 100 ms to avoid hammering
    if (lastTradeUpdate[key] && now - lastTradeUpdate[key] < 100) return;
    lastTradeUpdate[key] = now;
    const e = event as TradeExecutedEvent;
    try {
      await fomoTriggerOnTrade(e.stockId, e.quantity);
      await marketMakerOnTrade(e.stockId, e.price, e.quantity, e.tradeType);
    } catch (err) {
      console.error('[AlgoEngine] TRADE_EXECUTED handler error:', err);
    }
  }, { eventTypes: [MarketEventType.TRADE_EXECUTED] });
  subscriptionIds.push(tradeSub);

  // ORDERBOOK_UPDATED → All personas react (throttled)
    const lastBookUpdate: Record<string, number> = {};
    const bookSub = marketEvents.subscribe(async (event: MarketEvent) => {
      if (!engineRunning) return;
      if (event.type !== MarketEventType.ORDERBOOK_UPDATED) return;

      const { stockId } = event;
      const now = Date.now();
      // throttle per‑stock to one call per 200 ms
      if (lastBookUpdate[stockId] && now - lastBookUpdate[stockId] < 200) return;
      lastBookUpdate[stockId] = now;

      try {
        const aggression = getAggression(stockId);

        // Market Maker (slightly higher chance)
        if (Math.random() < 0.2) await marketMakerReact(stockId);

        // Sweeper probability scaled by aggression
        if (Math.random() < sweepProbability(aggression) * 0.1) await sweeperReact(stockId);

        // Spoofer occasional walls
        if (Math.random() < 0.03) await spooferReact(stockId);
      } catch (err) {
        console.error('[AlgoEngine] ORDERBOOK_UPDATED handler error:', err);
      }
    }, { eventTypes: [MarketEventType.ORDERBOOK_UPDATED] });
  subscriptionIds.push(bookSub);

  // ORDER_MATCHED → Clean up registry
  const matchSub = marketEvents.subscribe(async (event: MarketEvent) => {
    if (!engineRunning) return;
    if (event.type !== MarketEventType.ORDER_MATCHED) return;

    const e = event as OrderMatchedEvent;
    activeOrders.remove(e.buyOrderId);
    activeOrders.remove(e.sellOrderId);
  }, { eventTypes: [MarketEventType.ORDER_MATCHED] });
  subscriptionIds.push(matchSub);

  // FOMO_TRIGGERED → Sweeper goes wild
  const fomoSub = marketEvents.subscribe(async (event: MarketEvent) => {
    if (!engineRunning) return;
    if (event.type !== MarketEventType.FOMO_TRIGGERED) return;

    const { stockId } = event;
    try {
      await sweeperReact(stockId);
      await marketMakerReact(stockId);
    } catch (err) {
      console.error('[AlgoEngine] FOMO_TRIGGERED handler error:', err);
    }
  }, { eventTypes: [MarketEventType.FOMO_TRIGGERED] });
  subscriptionIds.push(fomoSub);

  // ORDER_CANCELLED → Clean up registry
  const cancelSub = marketEvents.subscribe(async (event: MarketEvent) => {
    if (!engineRunning) return;
    if (event.type !== MarketEventType.ORDER_CANCELLED) return;

    activeOrders.remove((event as any).orderId);
  }, { eventTypes: [MarketEventType.ORDER_CANCELLED] });
  subscriptionIds.push(cancelSub);
}

// ── Periodic Sweep (backup for stocks with no events) ────────────────────────

let lastPeriodicRun = 0;
async function periodicSweep(): Promise<void> {
  if (!engineRunning) return;

  // Throttle: max once per 100ms
  const now = Date.now();
  if (now - lastPeriodicRun < 100) return;
  lastPeriodicRun = now;

  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: 'market_status' } });
    if (config?.value !== 'OPEN') return;

    // Get stocks with trade activity — prioritize less active ones
    const stockList = await prisma.stock.findMany({ select: { id: true, lastPrice: true } });
    const tradeCounts: Record<string, number> = {};
    const counts = await prisma.trade.groupBy({
      by: ['stockId'],
      _count: { id: true },
    });
    for (const c of counts) {
      tradeCounts[c.stockId] = c._count.id;
    }

    // Sort: least-active first, so they get processed with higher priority
    const sorted = [...stockList].sort((a, b) => {
      const aCount = tradeCounts[a.id] || 0;
      const bCount = tradeCounts[b.id] || 0;
      return aCount - bCount;
    });

    // Process bottom (least active) with full probability, top (most active) reduced
    const BATCH_SIZE = 3;
    for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
      const batch = sorted.slice(i, i + BATCH_SIZE);
      
      for (const stock of batch) {
        if (stock.lastPrice <= 0) continue;

        const activityBias = Math.max(0.3, 1 - (tradeCounts[stock.id] || 0) / 500);
        // activityBias ≈ 1.0 for stocks with 0 trades, down to 0.3 for stocks with 350+ trades

        // Reduce activity briefly for SLEEPY to let orderbook rest
        if (Math.random() < SLEEPY_CHANCE) {
          setAggression(stock.id, 'SLEEPY');
        }

        const currentMode = getAggression(stock.id);
        
        // Escalate SLEEPY back to NORMAL
        if (currentMode === 'SLEEPY' && Math.random() < 0.4) {
          setAggression(stock.id, 'NORMAL');
        }

        // Periodic market maker tick — higher chance for less-active stocks
        if (Math.random() < Math.min(0.85, activityBias * 0.85)) {
          await marketMakerReact(stock.id);
        }

        // Periodic spoofer
        if (Math.random() < 0.15 * activityBias) {
          await spooferReact(stock.id);
        }

        // Periodic sweeper check — more bias for less-active to bootstrap price movement
        if (Math.random() < 0.2 * activityBias) {
          setAggression(stock.id, 'AGGRESSIVE');
          await sweeperReact(stock.id);
        }
      }
      
      // Delay between batches to prevent DB lock contention
      if (i + BATCH_SIZE < sorted.length) {
        await new Promise(r => setTimeout(r, 100));
      }

      // Periodically bump less-active stocks to AGGRESSIVE for more price movement
      if (Math.random() < 0.3) {
        const quiet = sorted[0];
        if (quiet && quiet.lastPrice > 0) setAggression(quiet.id, 'AGGRESSIVE');
      }
    }
  } catch (err) {
    console.error('[AlgoEngine] periodicSweep error:', err);
  }
}

// ── Force initial seed: bootstrap liquidity on ALL stocks ──────────────────

async function forceInitialSeed(): Promise<void> {
  try {
    const orderCount = await prisma.order.count({ where: { userId: systemBotUserId ?? '' } });
    if (orderCount > 0) {
      console.log(`[AlgoEngine] Skipping initial seed (${orderCount} existing orders).`);
      return;
    }
    const stocks = await prisma.stock.findMany({ where: { lastPrice: { gt: 0 } } });
    if (stocks.length === 0) return;
    console.log(`[AlgoEngine] Force-seeding ${stocks.length} stocks with initial liquidity...`);

    const MAX_STOCKS = 3; // only first 3 stocks to avoid startup lock contention
    for (let i = 0; i < Math.min(stocks.length, MAX_STOCKS); i++) {
      const stock = stocks[i];
      const tick = getTickSize(stock.lastPrice);
      const bidPrice = stock.lastPrice - tick;
      const offerPrice = stock.lastPrice + tick;
      if (bidPrice > 0) {
        await botPlaceOrder({
          stockId: stock.id, side: 'BID', price: bidPrice,
          quantity: 500, persona: 'MARKET_MAKER',
        }).catch(() => {});
      }
      if (offerPrice > 0) {
        await botPlaceOrder({
          stockId: stock.id, side: 'OFFER', price: offerPrice,
          quantity: 500, persona: 'MARKET_MAKER',
        }).catch(() => {});
      }
      setAggression(stock.id, Math.random() < 0.4 ? 'AGGRESSIVE' : 'NORMAL');
      await new Promise(r => setTimeout(r, 500)); // 500ms gap between stocks
    }
    console.log('[AlgoEngine] Initial seed complete.');
  } catch (err) {
    console.error('[AlgoEngine] forceInitialSeed error:', err);
  }
}

// ── Start / Stop ─────────────────────────────────────────────────────────────

export async function startAlgoEngine(): Promise<void> {
  if (engineRunning) return;
  engineRunning = true;

  await ensureSystemBot();
  subscribeEvents();
  await forceInitialSeed(); // bootstrap liquidity on ALL stocks

  console.log('[AlgoEngine] Starting with 4 personas: MARKET_MAKER, SWEEPER, SPOOFER, FOMO_TRIGGER');

  // Periodic evaluate orders (no delay - continuous)
  const runEvaluate = () => {
    if (!engineRunning) return;
    evaluateOrders().then(() => {
      setTimeout(runEvaluate, 0);
    });
  };
  runEvaluate();

  // Lightweight periodic sweep for market movement (no delay - continuous)
  const runPeriodicSweep = async () => {
    if (!engineRunning) return;
    try {
      await periodicSweep();
    } catch (err) {
      console.error('[AlgoEngine] periodicSweep error:', err);
    }
    setTimeout(runPeriodicSweep, 0);
  };
  setTimeout(runPeriodicSweep, 0);
}

export function stopAlgoEngine(): void {
  engineRunning = false;

  // Clear all FOMO timers
  for (const timer of fomoTimers.values()) {
    clearTimeout(timer);
  }
  fomoTimers.clear();

  // Unsubscribe all event listeners
  for (const id of subscriptionIds) {
    marketEvents.unsubscribe(id);
  }
  subscriptionIds.length = 0;

  console.log('[AlgoEngine] Stopped.');
}

// Export for monitoring
export function getEngineStats() {
  return {
    running: engineRunning,
    activeOrders: activeOrders.size,
    stockAggression: Object.fromEntries(stockAggression),
    systemBotUserId,
  };
}
