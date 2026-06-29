import { prisma } from './db';
import { marketEvents, MarketEventType } from './engine/eventManager';
import { computeAraArb } from './engine/araArb';
import { takeEquitySnapshot } from './engine/snapshotService';

export function initMarketScheduler() {
  console.log('Initializing Market Scheduler (ALWAYS OPEN mode for testing)...');

  // Always set market to OPEN for testing purposes
  prisma.systemConfig.upsert({
    where: { key: 'market_status' },
    update: { value: 'OPEN' },
    create: { key: 'market_status', value: 'OPEN' }
  }).then(async () => {
    console.log('Initial market status set to: OPEN (always)');

    // ── Reset ARA/ARB for all stocks on market open ──
    // 1. Simpan lastPrice sebagai previousClose (harga tutupan kemarin)
    // 2. Set referencePrice = previousClose sebagai acuan ARA/ARB hari ini
    const stocks = await prisma.stock.findMany();
    for (const s of stocks) {
      const prevClose = s.lastPrice || s.initialPrice;
      const { araPrice, arbPrice } = computeAraArb(prevClose);
      await prisma.stock.update({
        where: { id: s.id },
        data: {
          previousClose: prevClose,
          referencePrice: prevClose,
          araPrice,
          arbPrice,
        }
      });
    }
    console.log(`previousClose & ARA/ARB recalculated for ${stocks.length} stocks`);

    marketEvents.emit({
      type: MarketEventType.MARKET_STATUS,
      stockId: '*', // global event
      timestamp: new Date().toISOString(),
      status: 'OPEN',
    });
  });

  // ── Equity snapshot every 1 hour ──
  setInterval(() => {
    takeEquitySnapshot().catch(err => console.error('[Scheduler] Snapshot error:', err));
  }, 60 * 60 * 1000);
}
