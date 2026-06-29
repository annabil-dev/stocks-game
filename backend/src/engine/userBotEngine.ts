/**
 * UserBotEngine — processes user-purchased bots (NORMAL / INSTITUTION).
 *
 * Each user bot runs its own mini market-maker strategy using the
 * bot owner's account (not the system account). Bots place limit
 * orders near the last price, rotated across available stocks.
 *
 * NORMAL bot: small positions, single stock focus or rotate.
 * INSTITUTION bot: larger positions, wider coverage.
 */

import { prisma } from '../db';
import { placeOrder } from './matching';
import { getTickSize } from './tickSize';

// ── Helpers ──

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function snapToTick(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

// ── State ──

let engineRunning = false;
const BOT_IDS: string[] = [];
const ALL_STOCK_IDS: string[] = [];

// Track which stock each bot last traded (rotation)
const botStockCursor: Map<string, number> = new Map();

// ── Load stock list ──

async function ensureStockList(): Promise<void> {
  if (ALL_STOCK_IDS.length > 0) return;
  const stocks = await prisma.stock.findMany({
    where: { lastPrice: { gt: 0 } },
    select: { id: true },
    orderBy: { ticker: 'asc' },
  });
  ALL_STOCK_IDS.push(...stocks.map(s => s.id));
}

// ── Per-bot trading tick ──

interface BotRecord {
  id: string;
  ownerUserId: string;
  type: string;
  stockFocus: string | null;
  active: boolean;
}

async function botTick(bot: BotRecord): Promise<void> {
  try {
    // Determine which stock to trade
    let stockId: string | null = bot.stockFocus;
    if (!stockId) {
      // Rotate across stocks
      const cursor = botStockCursor.get(bot.id) || 0;
      if (cursor >= ALL_STOCK_IDS.length) botStockCursor.set(bot.id, 0);
      stockId = ALL_STOCK_IDS[cursor];
      botStockCursor.set(bot.id, (botStockCursor.get(bot.id) || 0) + 1);
    }
    if (!stockId) return;

    const user = await prisma.user.findUnique({
      where: { id: bot.ownerUserId },
      select: { id: true, cashBalance: true },
    });
    if (!user) return;

    // Check if user has enough cash (min 500K for NORMAL, 5M for INSTITUTION)
    const minCash = bot.type === 'INSTITUTION' ? 5_000_000 : 500_000;
    if (Number(user.cashBalance) < minCash) return;

    const stock = await prisma.stock.findUnique({
      where: { id: stockId },
      select: { id: true, lastPrice: true, previousClose: true },
    });
    if (!stock || stock.lastPrice <= 0 || stock.previousClose <= 0) return;

    const tick = getTickSize(stock.lastPrice);
    const price = stock.lastPrice;

    // Check orderbook: don't pile on if already quoting
    const existing = await prisma.order.findFirst({
      where: {
        userId: bot.ownerUserId,
        stockId,
        side: 'BID',
        status: { in: ['OPEN', 'PARTIAL'] },
      },
    });
    if (existing) return; // Already has open orders — skip

    // Compute quantity: percentage of available cash
    const cash = Number(user.cashBalance);
    const maxQty = bot.type === 'INSTITUTION'
      ? Math.floor(cash * 0.1 / price / 100) * 100  // 10% of cash
      : Math.floor(cash * 0.05 / price / 100) * 100;  // 5% of cash

    if (maxQty < 100) return; // Minimum 1 lot

    const quantity = Math.min(maxQty, randomInt(100, Math.max(100, maxQty)));

    // Place BID at lastPrice - 1 tick
    const bidPrice = snapToTick(price - tick, tick);
    if (bidPrice > 0) {
      await placeOrder({
        userId: bot.ownerUserId,
        stockId,
        side: 'BID',
        price: bidPrice,
        quantity,
        type: 'LIMIT',
      }).catch(() => {});
    }

    // Check portfolio for OFFER side
    const portfolio = await prisma.portfolio.findUnique({
      where: { userId_stockId: { userId: bot.ownerUserId, stockId } },
    });
    const offerQty = portfolio?.quantity || 0;
    if (offerQty >= quantity / 2) {
      const offerPrice = snapToTick(price + tick, tick);
      if (offerPrice > 0) {
        await placeOrder({
          userId: bot.ownerUserId,
          stockId,
          side: 'OFFER',
          price: offerPrice,
          quantity: Math.min(quantity, Math.floor(offerQty / 100) * 100),
          type: 'LIMIT',
        }).catch(() => {});
      }
    }
  } catch {
    // Swallow per-bot errors — don't crash engine
  }
}

// ── Main loop ──

async function mainTick(): Promise<void> {
  if (!engineRunning) return;

  try {
    await ensureStockList();
    if (ALL_STOCK_IDS.length === 0) return;

    const bots = await prisma.bot.findMany({
      where: { active: true },
    });

    // Process each bot (sequential to avoid DB storms)
    for (const bot of bots) {
      if (!engineRunning) return;
      await botTick(bot as BotRecord);
      // Small delay between bots
      await new Promise(r => setTimeout(r, 50));
    }
  } catch (err) {
    console.error('[UserBotEngine] mainTick error:', err);
  }
}

// ── Start / Stop ──

export function startUserBotEngine(): void {
  if (engineRunning) return;
  engineRunning = true;

  console.log('[UserBotEngine] Starting — processes user-purchased bots');

  const run = () => {
    if (!engineRunning) return;
    mainTick().then(() => {
      const delay = randomInt(8000, 15000); // Every 8-15 seconds
      setTimeout(run, delay);
    });
  };
  run();
}

export function stopUserBotEngine(): void {
  engineRunning = false;
  console.log('[UserBotEngine] Stopped.');
}

export function getUserBotStats() {
  return { running: engineRunning, botsTracked: BOT_IDS.length };
}
