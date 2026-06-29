import { Router } from 'express';
import { prisma } from './db';
import { placeOrder } from './engine/matching';

const router = Router();

// Get or create default player
router.get('/me', async (req, res) => {
  let user = await prisma.user.findUnique({ where: { email: 'player@bursasimulasi.com' } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'player@bursasimulasi.com',
        passwordHash: 'none',
        cashBalance: 100000000
      }
    });
  }
  res.json(user);
});

// Get current market status
router.get('/market-status', async (req, res) => {
  const config = await prisma.systemConfig.findUnique({ where: { key: 'market_status' } });
  res.json({ status: config?.value || 'CLOSED' });
});

// Get list of stocks
router.get('/stocks', async (req, res) => {
  const stocks = await prisma.stock.findMany({
    orderBy: { ticker: 'asc' }
  });
  res.json(stocks);
});

// Get accumulated trade volumes per stock (for dashboard rehydrate on reload)
router.get('/market/volumes', async (req, res) => {
  try {
    // Use raw query for efficient SUM(price * quantity) grouped by stockId
    const rows = await prisma.$queryRawUnsafe<Array<{
      stockId: string;
      volume: bigint;
      value: bigint;
      tradeCount: bigint;
    }>>(`
      SELECT 
        "stockId",
        COALESCE(SUM(quantity), 0) as volume,
        COALESCE(SUM(price * quantity), 0) as value,
        COUNT(*) as "tradeCount"
      FROM "Trade"
      GROUP BY "stockId"
    `);
    const volumes: Record<string, { volume: number; value: number; tradeCount: number }> = {};
    for (const r of rows) {
      volumes[r.stockId] = {
        volume: Number(r.volume),
        value: Number(r.value),
        tradeCount: Number(r.tradeCount),
      };
    }
    res.json(volumes);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get a stock's order book (aggregated)
router.get('/stocks/:id/orderbook', async (req, res) => {
  const stockId = req.params.id;
  
  // Aggregate bids
  const bids = await prisma.order.groupBy({
    by: ['price'],
    where: { stockId, side: 'BID', status: { in: ['OPEN', 'PARTIAL'] } },
    _sum: { remainingQuantity: true },
    orderBy: { price: 'desc' },
    take: 10
  });

  // Aggregate offers
  const offers = await prisma.order.groupBy({
    by: ['price'],
    where: { stockId, side: 'OFFER', status: { in: ['OPEN', 'PARTIAL'] } },
    _sum: { remainingQuantity: true },
    orderBy: { price: 'asc' },
    take: 10
  });

  res.json({
    bids: bids.map(b => ({ price: Number(b.price), quantity: b._sum.remainingQuantity })),
    offers: offers.map(o => ({ price: Number(o.price), quantity: o._sum.remainingQuantity }))
  });
});

// Get recent trades for a stock
router.get('/stocks/:id/trades', async (req, res) => {
  const stockId = req.params.id;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const trades = await prisma.trade.findMany({
    where: { stockId },
    orderBy: { executedAt: 'desc' },
    take: limit
  });

  res.json(trades.map(t => ({
    price: t.price,
    quantity: t.quantity,
    type: t.type,
    executedAt: t.executedAt
  })));
});

// Get user's portfolio
router.get('/portfolio/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const portfolios = await prisma.portfolio.findMany({
      where: { userId, quantity: { gt: 0 } },
      include: { stock: true }
    });

    const result = portfolios.map(p => {
      const quantity = Number(p.quantity);
      const avgPrice = Number(p.avgPrice);
      const lastPrice = Number(p.stock.lastPrice);
      const initialPrice = Number(p.stock.initialPrice);
      const changePct = initialPrice ? ((lastPrice - initialPrice) / initialPrice) * 100 : 0;
      const value = quantity * lastPrice;
      const cost = quantity * avgPrice;
      const profitLoss = value - cost;

      return {
        stockId: p.stockId,
        ticker: p.stock.ticker,
        name: p.stock.name,
        quantity,
        avgPrice,
        lastPrice,
        changePct: Math.round(changePct * 100) / 100,
        value,
        profitLoss
      };
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Place an order
router.post('/orders', async (req, res) => {
  try {
    const { userId, stockId, side, price, quantity, type } = req.body;
    
    if (!userId || !stockId || !side || price === undefined || price === null || !quantity || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await placeOrder({
      userId,
      stockId,
      side,
      price: Number(price),
      quantity: Number(quantity),
      type
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to place order' });
  }
});

// Get user orders (supports status filter for open orders)
router.get('/orders', async (req, res) => {
  try {
    const { userId, stockId, status } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const where: any = { userId: userId as string };
    if (stockId) where.stockId = stockId as string;
    if (status) {
      const statuses = (status as string).split(',').map(s => s.trim().toUpperCase());
      where.status = { in: statuses };
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { stock: { select: { ticker: true } } },
    });

    res.json(orders.map(o => {
      const filledQty = o.quantity - o.remainingQuantity;
      // Infer type: if status is OPEN/PARTIAL with remainingQty < quantity → HAKA/HAKI, else LIMIT
      const type = filledQty > 0 && o.status === 'PARTIAL' ? 'HAKA/HAKI' : 'LIMIT';
      return {
        id: o.id,
        side: o.side,
        price: Number(o.price),
        quantity: o.quantity,
        filledQty,
        status: o.status,
        type,
        createdAt: o.createdAt,
        stock: o.stock ? { ticker: o.stock.ticker } : undefined,
      };
    }));
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── Cancel an open order (P1) ──────────────────────────────
router.delete('/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { userId } = req.body; // simple ownership check (no JWT)

    if (!userId) return res.status(400).json({ error: 'userId required' });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { stock: { select: { ticker: true } } },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== userId) return res.status(403).json({ error: 'Not your order' });
    if (!['OPEN', 'PARTIAL'].includes(order.status)) {
      return res.status(400).json({ error: `Order status ${order.status} cannot be cancelled` });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Refund locked funds/stock based on side
      if (order.side === 'BID') {
        // Refund cash: remainingQty * price
        const refund = order.remainingQuantity * Number(order.price);
        await tx.user.update({
          where: { id: userId },
          data: { cashBalance: { increment: refund } },
        });
      } else {
        // Refund stock: remainingQuantity back to portfolio
        await tx.portfolio.upsert({
          where: { userId_stockId: { userId, stockId: order.stockId } },
          update: { quantity: { increment: order.remainingQuantity } },
          create: { userId, stockId: order.stockId, quantity: order.remainingQuantity, avgPrice: Number(order.price) },
        });
      }

      // Mark order as CANCELLED (keep remainingQuantity for history)
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      });

      return updated;
    });

    // Emit orderbook update so clients refresh depth
    const io = (global as any).__io;
    if (io) {
      io.to(`stock:${order.stockId}`).emit('orderbook:update', { stockId: order.stockId });
    }

    res.json({
      success: true,
      orderId: result.id,
      status: result.status,
      refunded: order.side === 'BID'
        ? `${(order.remainingQuantity * Number(order.price)).toLocaleString('id-ID')}`
        : `${order.remainingQuantity} shares`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to cancel order' });
  }
});

// Get user's bots
router.get('/bots/:userId', async (req, res) => {
  try {
    const bots = await prisma.bot.findMany({
      where: { ownerUserId: req.params.userId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(bots);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buy a bot
router.post('/bots/buy', async (req, res) => {
  try {
    const { userId, type, stockFocus } = req.body;

    if (!userId || !type) {
      return res.status(400).json({ error: 'Missing required fields (userId, type)' });
    }

    if (!['NORMAL', 'INSTITUTION'].includes(type)) {
      return res.status(400).json({ error: 'Invalid bot type. Must be NORMAL or INSTITUTION' });
    }

    // Institution bot: require portfolio > 1 Billion IDR
    if (type === 'INSTITUTION') {
      const portfolios = await prisma.portfolio.findMany({
        where: { userId, quantity: { gt: 0 } },
        include: { stock: true }
      });
      const totalValue = portfolios.reduce((sum, p) => sum + (p.quantity * Number(p.stock.lastPrice)), 0);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const totalPortfolio = totalValue + Number(user.cashBalance);

      if (totalPortfolio < 1_000_000_000) {
        return res.status(400).json({
          error: `Portfolio must exceed Rp 1,000,000,000 to unlock Institution Bot. Current: Rp ${totalPortfolio.toLocaleString('id-ID')}`
        });
      }
    }

    // Charge user for the bot
    const price = type === 'INSTITUTION' ? 50000000 : 5000000;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (Number(user.cashBalance) < price) {
      return res.status(400).json({
        error: `Insufficient cash. Need Rp ${price.toLocaleString('id-ID')}, have Rp ${Number(user.cashBalance).toLocaleString('id-ID')}`
      });
    }

    // Deduct cash and create bot
    const bot = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { cashBalance: { decrement: price } }
      });

      return tx.bot.create({
        data: {
          ownerUserId: userId,
          type,
          stockFocus: stockFocus || null,
          active: true
        }
      });
    });

    res.status(201).json(bot);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to buy bot' });
  }
});

// ── GET /api/portfolio/history ──
router.get('/portfolio/history', async (req, res) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    const days = 14;

    // Current state
    const userFresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const holdings = await prisma.portfolio.findMany({
      where: { userId: user.id, quantity: { gt: 0 } },
      include: { stock: true }
    });
    const currentCash = Number(userFresh.cashBalance);
    const currentPortfolioValue = holdings.reduce((s, p) => s + p.quantity * Number(p.stock.lastPrice), 0);
    const totalEquity = currentCash + currentPortfolioValue;

    // Reconstruct initial cash from ALL trades via Order relations
    const allTrades = await prisma.trade.findMany({
      where: { OR: [{ buyOrder: { userId: user.id } }, { sellOrder: { userId: user.id } }] },
      include: { buyOrder: true, sellOrder: true },
      orderBy: { executedAt: 'asc' }
    });
    let initialCash = currentCash;
    for (const t of allTrades) {
      if (t.buyOrder.userId === user.id) initialCash += t.price * t.quantity;
      if (t.sellOrder.userId === user.id) initialCash -= t.price * t.quantity;
    }

    // Trades in the past 14 days
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    const recentTrades = await prisma.trade.findMany({
      where: {
        OR: [{ buyOrder: { userId: user.id } }, { sellOrder: { userId: user.id } }],
        executedAt: { gte: startDate }
      },
      include: { stock: true, buyOrder: true, sellOrder: true },
      orderBy: { executedAt: 'asc' }
    });

    // Group trades by date key
    const dayMap = new Map<string, typeof recentTrades>();
    for (const t of recentTrades) {
      const dk = t.executedAt.toISOString().slice(0, 10);
      if (!dayMap.has(dk)) dayMap.set(dk, []);
      dayMap.get(dk)!.push(t);
    }

    // Walk forward from 14 days ago → today
    const history: Array<{ date: string; equity: number; cash: number; portfolioValue: number }> = [];
    let cash = initialCash;
    const hMap: Record<string, { qty: number }> = {};

    for (let i = days; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dk = d.toISOString().slice(0, 10);

      const dayTrades = dayMap.get(dk) || [];
      for (const t of dayTrades) {
        if (t.buyOrder.userId === user.id) {
          cash -= t.price * t.quantity;
          hMap[t.stockId] = hMap[t.stockId] || { qty: 0 };
          hMap[t.stockId].qty += t.quantity;
        }
        if (t.sellOrder.userId === user.id) {
          cash += t.price * t.quantity;
          if (hMap[t.stockId]) hMap[t.stockId].qty -= t.quantity;
        }
      }

      // Portfolio value using current prices
      let pv = 0;
      for (const [sid, h] of Object.entries(hMap)) {
        if (h.qty > 0) {
          const s = holdings.find(p => p.stockId === sid);
          if (s) pv += h.qty * Number(s.stock.lastPrice);
        }
      }

      history.push({ date: dk, equity: cash + pv, cash, portfolioValue: pv });
    }

    const totalReturnValue = totalEquity - initialCash;
    const totalReturn = initialCash > 0 ? (totalReturnValue / initialCash) * 100 : 0;

    res.json({ history, totalEquity, totalReturn: Math.round(totalReturn * 100) / 100, totalReturnValue });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/portfolio/trades ──
router.get('/portfolio/trades', async (req, res) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const trades = await prisma.trade.findMany({
      where: { OR: [{ buyOrder: { userId: user.id } }, { sellOrder: { userId: user.id } }] },
      include: { stock: true, buyOrder: true, sellOrder: true },
      orderBy: { executedAt: 'desc' },
      take: limit
    });

    // Build cost basis from buy-side trades
    const costBasis: Record<string, { totalCost: number; totalQty: number }> = {};
    const allBuys = await prisma.trade.findMany({
      where: { buyOrder: { userId: user.id } },
      include: { buyOrder: true },
      orderBy: { executedAt: 'asc' }
    });
    for (const t of allBuys) {
      costBasis[t.stockId] = costBasis[t.stockId] || { totalCost: 0, totalQty: 0 };
      costBasis[t.stockId].totalCost += t.price * t.quantity;
      costBasis[t.stockId].totalQty += t.quantity;
    }

    let totalRealizedGain = 0;
    let totalRealizedLoss = 0;
    let winningTrades = 0;
    let totalSellTrades = 0;

    const result = trades.map(t => {
      const side = t.buyOrder.userId === user.id ? 'BUY' : 'SELL';
      let realizedPnL = 0;

      if (side === 'SELL') {
        const cb = costBasis[t.stockId];
        const avgCost = cb && cb.totalQty > 0 ? cb.totalCost / cb.totalQty : 0;
        realizedPnL = (t.price - avgCost) * t.quantity;
        totalSellTrades++;
        if (realizedPnL > 0) { totalRealizedGain += realizedPnL; winningTrades++; }
        else if (realizedPnL < 0) { totalRealizedLoss += realizedPnL; }
      }

      return {
        id: t.id,
        ticker: t.stock.ticker,
        name: t.stock.name,
        side,
        price: t.price,
        quantity: t.quantity,
        realizedPnL: Math.round(realizedPnL),
        executedAt: t.executedAt
      };
    });

    const winRate = totalSellTrades > 0 ? (winningTrades / totalSellTrades) * 100 : 0;

    res.json({
      trades: result,
      totalRealizedGain: Math.round(totalRealizedGain),
      totalRealizedLoss: Math.round(totalRealizedLoss),
      winRate: Math.round(winRate * 100) / 100,
      totalTrades: trades.length,
      winningTrades
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/portfolio/allocation ──
router.get('/portfolio/allocation', async (req, res) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const holdings = await prisma.portfolio.findMany({
      where: { userId: user.id, quantity: { gt: 0 } },
      include: { stock: true }
    });

    let totalValue = 0;
    const items = holdings.map(p => {
      const qty = p.quantity;
      const avgPrice = Number(p.avgPrice);
      const currentPrice = Number(p.stock.lastPrice);
      const value = qty * currentPrice;
      totalValue += value;
      const unrealizedPnL = value - qty * avgPrice;
      return {
        ticker: p.stock.ticker,
        name: p.stock.name,
        value,
        quantity: qty,
        avgPrice,
        currentPrice,
        unrealizedPnL: Math.round(unrealizedPnL),
        unrealizedPnLPercent: avgPrice > 0 ? Math.round(((currentPrice - avgPrice) / avgPrice) * 10000) / 100 : 0
      };
    });

    items.sort((a, b) => b.value - a.value);

    const allocation = items.map(item => ({
      ...item,
      percentage: totalValue > 0 ? Math.round((item.value / totalValue) * 10000) / 100 : 0
    }));

    res.json(allocation);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/portfolio/:userId/equity-history ──
router.get('/portfolio/:userId/equity-history', async (req, res) => {
  try {
    const { userId } = req.params;
    const range = (req.query.range as string) || '1M';

    // Calculate date cutoff based on range
    const cutoff = new Date();
    const rangeMap: Record<string, number> = { '1W': 7, '1M': 30, '3M': 90, '1Y': 365 };
    if (range !== 'All' && range in rangeMap) {
      cutoff.setDate(cutoff.getDate() - rangeMap[range]);
    } else if (range === 'YTD') {
      cutoff.setMonth(0, 1);
      cutoff.setHours(0, 0, 0, 0);
    } else {
      cutoff.setFullYear(2000, 0, 1); // All
    }

    const snapshots = await prisma.equitySnapshot.findMany({
      where: { userId, createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'asc' },
      select: { totalEquity: true, cashBalance: true, portfolioValue: true, createdAt: true },
    });

    res.json({ range, snapshots });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/portfolio/:userId/trade-stats ──
router.get('/portfolio/:userId/trade-stats', async (req, res) => {
  try {
    const { userId } = req.params;
    const period = (req.query.period as string) || 'all';

    // Date filter
    const cutoff = period === 'mtd' ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(0);

    const realizedTrades = await prisma.realizedTrade.findMany({
      where: { userId, closedAt: { gte: cutoff } },
      include: { stock: { select: { ticker: true, name: true } } },
      orderBy: { closedAt: 'desc' },
    });

    // Summary stats
    let totalProfitLoss = 0;
    let totalWins = 0, totalLosses = 0;
    let totalBuyVolume = 0, totalSellVolume = 0;
    let totalWinPL = 0, totalLossPL = 0;

    for (const t of realizedTrades) {
      totalProfitLoss += t.profitLoss;
      if (t.profitLoss > 0) { totalWins++; totalWinPL += t.profitLoss; }
      else if (t.profitLoss < 0) { totalLosses++; totalLossPL += Math.abs(t.profitLoss); }
      totalBuyVolume += t.buyPrice * t.quantity;
      totalSellVolume += t.sellPrice * t.quantity;
    }

    const winRate = (totalWins + totalLosses) > 0
      ? Math.round((totalWins / (totalWins + totalLosses)) * 10000) / 100
      : 0;
    const profitFactor = totalLossPL > 0 ? Math.round((totalWinPL / totalLossPL) * 100) / 100 : totalWinPL > 0 ? 999 : 0;

    res.json({
      period,
      totalTrades: realizedTrades.length,
      totalProfitLoss,
      winRate,
      profitFactor,
      totalWins,
      totalLosses,
      totalBuyVolume,
      totalSellVolume,
      trades: realizedTrades,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/market/stats ──
router.get('/market/stats', async (_req, res) => {
  try {
    const stocks = await prisma.stock.findMany({ orderBy: { ticker: 'asc' } });
    const trades = await prisma.trade.findMany({
      orderBy: { executedAt: 'desc' }
    });

    // Aggregate volume/value/frequency per stock from all trades
    const stockTradeMap: Record<string, { volume: number; value: number; frequency: number }> = {};
    for (const t of trades) {
      if (!stockTradeMap[t.stockId]) stockTradeMap[t.stockId] = { volume: 0, value: 0, frequency: 0 };
      stockTradeMap[t.stockId].volume += t.quantity;
      stockTradeMap[t.stockId].value += t.price * t.quantity;
      stockTradeMap[t.stockId].frequency += 1;
    }

    const stockDetails = stocks.map(s => {
      const lastPrice = Number(s.lastPrice);
      const prevClose = Number(s.previousClose);
      const change = lastPrice - prevClose;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
      const agg = stockTradeMap[s.id] || { volume: 0, value: 0, frequency: 0 };
      return {
        ticker: s.ticker,
        lastPrice,
        change,
        changePercent: Math.round(changePercent * 100) / 100,
        volume: agg.volume,
        value: agg.value,
        frequency: agg.frequency
      };
    });

    // Composite: simple average of all stock prices, change from prevClose avg
    let sumPrice = 0, sumPrevClose = 0, totalMarketCap = 0, totalVolume = 0, totalValue = 0, totalFreq = 0;
    let openSum = 0, highSum = 0, lowSum = 0;
    for (const s of stocks) {
      const lp = Number(s.lastPrice);
      const pc = Number(s.previousClose);
      const ip = Number(s.initialPrice);
      const agg = stockTradeMap[s.id] || { volume: 0, value: 0, frequency: 0 };
      sumPrice += lp;
      sumPrevClose += pc;
      openSum += ip;
      highSum += lp; // approximated as lastPrice
      lowSum += ip;  // approximated as initialPrice
      totalMarketCap += lp * 1_000_000; // assume 1M shares outstanding per stock
      totalVolume += agg.volume;
      totalValue += agg.value;
      totalFreq += agg.frequency;
    }

    const n = stocks.length || 1;
    const composite = Math.round((sumPrice / n) * 100) / 100;
    const prevCloseAvg = Math.round((sumPrevClose / n) * 100) / 100;
    const compChange = Math.round((composite - prevCloseAvg) * 100) / 100;
    const compChangePercent = prevCloseAvg > 0 ? Math.round((compChange / prevCloseAvg) * 10000) / 100 : 0;
    const per = Math.round((composite / (composite * 0.08)) * 100) / 100; // simulated P/E ~12.5x
    const pbv = Math.round((composite / (composite * 0.65)) * 100) / 100; // simulated P/BV ~1.54x

    res.json({
      composite,
      change: compChange,
      changePercent: compChangePercent,
      volume: totalVolume,
      value: totalValue,
      frequency: totalFreq,
      open: Math.round(openSum / n),
      high: Math.round(highSum / n),
      low: Math.round(lowSum / n),
      prevClose: prevCloseAvg,
      marketCap: totalMarketCap,
      per,
      pbv,
      stocks: stockDetails
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/market/foreign-flow ──
router.get('/market/foreign-flow', async (_req, res) => {
  try {
    const stocks = await prisma.stock.findMany({ orderBy: { ticker: 'asc' } });
    const trades = await prisma.trade.findMany();

    // Aggregate per stock
    const stockTradeMap: Record<string, { volume: number; value: number; frequency: number }> = {};
    for (const t of trades) {
      if (!stockTradeMap[t.stockId]) stockTradeMap[t.stockId] = { volume: 0, value: 0, frequency: 0 };
      stockTradeMap[t.stockId].volume += t.quantity;
      stockTradeMap[t.stockId].value += t.price * t.quantity;
      stockTradeMap[t.stockId].frequency += 1;
    }

    let totalForeignLot = 0;
    let totalDomesticLot = 0;
    let totalValue = 0;
    let totalFreq = 0;

    const perStock = stocks.map(s => {
      const lastPrice = Number(s.lastPrice);
      const prevClose = Number(s.previousClose);
      const changePercent = prevClose > 0 ? ((lastPrice - prevClose) / prevClose) * 100 : 0;
      const agg = stockTradeMap[s.id] || { volume: 0, value: 0, frequency: 0 };

      // ~40% foreign, ~60% domestic
      const foreignShare = 0.35 + Math.random() * 0.1;
      const foreignVol = Math.round(agg.volume * foreignShare);
      const domesticVol = agg.volume - foreignVol;
      const foreignVal = Math.round(agg.value * foreignShare);

      totalForeignLot += foreignVol;
      totalDomesticLot += domesticVol;
      totalValue += agg.value;
      totalFreq += agg.frequency;

      return {
        ticker: s.ticker,
        netForeignBuy: foreignVol - domesticVol,
        value: foreignVal,
        volume: foreignVol,
        freq: agg.frequency,
        price: lastPrice,
        changePercent: Math.round(changePercent * 100) / 100
      };
    });

    // Top 10 by net foreign buy
    perStock.sort((a, b) => b.netForeignBuy - a.netForeignBuy);
    const top10 = perStock.slice(0, 10);

    res.json({
      top10,
      total: {
        foreignLot: totalForeignLot,
        domesticLot: totalDomesticLot,
        totalValue,
        totalFreq
      }
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/market/ihsg-history ──
router.get('/market/ihsg-history', async (_req, res) => {
  try {
    const stocks = await prisma.stock.findMany();
    const now = new Date();

    // Calculate current composite
    let sumPrice = 0, sumPrevClose = 0;
    for (const s of stocks) {
      sumPrice += Number(s.lastPrice);
      sumPrevClose += Number(s.previousClose);
    }
    const n = stocks.length || 1;
    const currentComposite = sumPrice / n;
    const prevCloseAvg = sumPrevClose / n;

    // Generate 5-min intervals from 09:00 to end of session (16:30) or now
    // Always return a full trading session worth of data, even if it's currently before 09:00
    const points: Array<{ time: string; value: number; netBuy: number; netSell: number }> = [];
    const start = new Date(now);
    start.setHours(9, 0, 0, 0);
    const sessionEnd = new Date(now);
    sessionEnd.setHours(16, 30, 0, 0);
    const endTime = now >= start ? (now < sessionEnd ? now : sessionEnd) : sessionEnd;

    let cursor = new Date(start);
    let idx = 0;
    const totalIntervals = Math.max(1, Math.floor((endTime.getTime() - start.getTime()) / (5 * 60 * 1000)));

    while (cursor <= endTime && idx <= totalIntervals) {
      const progress = totalIntervals > 0 ? idx / totalIntervals : 1;
      // Interpolate from prevClose to currentComposite with slight noise
      const base = prevCloseAvg + (currentComposite - prevCloseAvg) * progress;
      const noise = (Math.random() - 0.5) * prevCloseAvg * 0.002;
      const value = Math.round((base + noise) * 100) / 100;

      const buyVol = Math.round(Math.random() * 5000 + 1000);
      const sellVol = Math.round(Math.random() * 5000 + 1000);

      const hh = String(cursor.getHours()).padStart(2, '0');
      const mm = String(cursor.getMinutes()).padStart(2, '0');

      points.push({ time: `${hh}:${mm}`, value, netBuy: buyVol, netSell: sellVol });

      cursor = new Date(cursor.getTime() + 5 * 60 * 1000);
      idx++;
    }

    res.json({ points });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/market/sectors ──
router.get('/market/sectors', async (_req, res) => {
  try {
    const stocks = await prisma.stock.findMany({ orderBy: { ticker: 'asc' } });

    const sectorMap: Record<string, string[]> = {
      'Banking': ['BBCA.JK', 'BBRI.JK', 'BMRI.JK', 'BBNI.JK'],
      'Basic Industry': ['SMGR.JK', 'ASII.JK', 'UNTR.JK', 'ADRO.JK', 'PTBA.JK'],
      'Consumer': ['ICBP.JK', 'INDF.JK', 'KLBF.JK', 'UNVR.JK'],
      'Energy': ['ADRO.JK', 'PGAS.JK', 'PTBA.JK', 'MDKA.JK'],
      'Property': ['GOTO.JK', 'SMGR.JK']
    };

    // Build ticker → stock map
    const stockMap: Record<string, typeof stocks[0]> = {};
    for (const s of stocks) stockMap[s.ticker] = s;

    const sectors = Object.entries(sectorMap).map(([name, tickers]) => {
      const matched = tickers
        .map(t => stockMap[t])
        .filter(Boolean)
        .map(s => {
          const lastPrice = Number(s.lastPrice);
          const prevClose = Number(s.previousClose);
          const change = lastPrice - prevClose;
          const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
          return { ticker: s.ticker, change, changePercent: Math.round(changePercent * 100) / 100 };
        });

      // Sector change = average of constituent changes
      const avgChange = matched.length > 0 ? matched.reduce((s, x) => s + x.change, 0) / matched.length : 0;
      const avgChangePct = matched.length > 0 ? matched.reduce((s, x) => s + x.changePercent, 0) / matched.length : 0;

      // Sort by change desc for topStocks
      matched.sort((a, b) => b.change - a.change);

      return {
        name,
        change: Math.round(avgChange * 100) / 100,
        changePercent: Math.round(avgChangePct * 100) / 100,
        topStocks: matched
      };
    });

    res.json({ sectors });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/market/global-indices ──
router.get('/market/global-indices', async (_req, res) => {
  try {
    const baseIndices = [
      { name: 'S&P 500', value: 5450, spread: 0.008 },
      { name: 'DOW30', value: 39800, spread: 0.006 },
      { name: 'HANGSENG', value: 18200, spread: 0.01 },
      { name: 'NIKKEI', value: 38500, spread: 0.009 },
      { name: 'SHANGHAI', value: 3050, spread: 0.007 },
      { name: 'CAC40', value: 7600, spread: 0.007 },
      { name: 'DAX', value: 18400, spread: 0.008 },
      { name: 'FTSE', value: 8150, spread: 0.006 }
    ];

    const indices = baseIndices.map(idx => {
      const variation = (Math.random() - 0.5) * 2 * idx.spread;
      const value = Math.round(idx.value * (1 + variation) * 100) / 100;
      const change = Math.round(idx.value * variation * 100) / 100;
      const changePercent = Math.round(variation * 10000) / 100;
      return { name: idx.name, value, change, changePercent };
    });

    res.json({ indices });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/liquidity-mode ──
router.get('/liquidity-mode', async (_req, res) => {
  try {
    const { getLiquidityMode, getLiquidityConfig } = await import('./engine/liquidityManager');
    const mode = getLiquidityMode();
    const config = getLiquidityConfig();
    res.json({ mode, config: { spreadThreshold: config.spreadThreshold, mmMinQty: config.mmMinQty, mmMaxQty: config.mmMaxQty } });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /api/brokers/top ──
// Top brokers by executed trade value, aggregated from Order table.
// Faster than joining Trade → Order because Order table has fewer rows
// and carries brokerId directly.
router.get('/brokers/top', async (req, res) => {
  try {
    const stockId = req.query.stockId as string | undefined;
    const date = req.query.date as string | undefined;

    // Aggregate executed volume per broker from Orders (filled/partial)
    // For LIMIT orders the recorded price is accurate; for HAKA/HAKI the
    // recorded price was adjusted to match execution — close enough for visual.
    const stockFilter = stockId ? `AND o.stockId = '${stockId}'` : '';
    const dateFilter = date ? `AND DATE(o.createdAt) = '${date}'` : '';

    const rows = await prisma.$queryRawUnsafe<Array<{
      brokerId: string;
      buyValue: number;
      sellValue: number;
    }>>(`
      SELECT
        o.brokerId,
        COALESCE(SUM(CASE WHEN o.side='BID'   THEN o.price * (o.quantity - o.remainingQuantity) ELSE 0 END), 0) AS buyValue,
        COALESCE(SUM(CASE WHEN o.side='OFFER' THEN o.price * (o.quantity - o.remainingQuantity) ELSE 0 END), 0) AS sellValue
      FROM "Order" o
      WHERE o.brokerId IS NOT NULL
        AND o.status IN ('FILLED', 'PARTIAL')
        ${stockFilter}
        ${dateFilter}
      GROUP BY o.brokerId
      ORDER BY buyValue + sellValue DESC
      LIMIT 15
    `);

    const brokerMap: Record<string, { buyValue: number; sellValue: number }> = {};
    for (const r of rows as any[]) {
      const bid = String(r.brokerId);
      brokerMap[bid] = {
        buyValue: Number(r.buyValue),
        sellValue: Number(r.sellValue),
      };
    }

    const allBrokers = await prisma.broker.findMany();
    const result = allBrokers
      .map(b => {
        const vals = brokerMap[b.id];
        if (!vals) return null;
        const totalVal = vals.buyValue + vals.sellValue;
        return {
          id: b.id,
          code: b.code,
          name: b.name,
          totalValue: totalVal,
          buyValue: vals.buyValue,
          sellValue: vals.sellValue,
          netValue: vals.buyValue - vals.sellValue,
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 15);

    res.json({ brokers: result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;