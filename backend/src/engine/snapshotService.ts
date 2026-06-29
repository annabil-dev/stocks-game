import { prisma } from '../db';

/**
 * Take an equity snapshot for all users.
 * Computes cashBalance + portfolio value (qty * stock.lastPrice) and stores it.
 */
export async function takeEquitySnapshot(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { not: { contains: 'systembot' } } },
    select: { id: true, cashBalance: true },
  });

  const stocks = await prisma.stock.findMany({
    select: { id: true, lastPrice: true },
  });
  const stockPriceMap = new Map(stocks.map(s => [s.id, Number(s.lastPrice)]));

  const portfolios = await prisma.portfolio.findMany({
    where: { quantity: { gt: 0 } },
    select: { userId: true, stockId: true, quantity: true },
  });

  // Aggregate portfolio value per user
  const portfolioValueMap = new Map<string, number>();
  for (const p of portfolios) {
    const price = stockPriceMap.get(p.stockId) ?? 0;
    const value = p.quantity * price;
    portfolioValueMap.set(p.userId, (portfolioValueMap.get(p.userId) ?? 0) + value);
  }

  const now = new Date();
  const snapshots = users.map(u => {
    const cash = Number(u.cashBalance);
    const pv = portfolioValueMap.get(u.id) ?? 0;
    const total = cash + pv;
    return {
      userId: u.id,
      cashBalance: cash,
      portfolioValue: pv,
      totalEquity: total,
      createdAt: now,
    };
  });

  if (snapshots.length === 0) return;

  await prisma.equitySnapshot.createMany({ data: snapshots });
  console.log(`[Snapshot] Equity snapshot taken for ${snapshots.length} users at ${now.toISOString()}`);
}
