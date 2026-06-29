import assert from 'assert';
import { prisma } from '../db';
import { placeOrder } from './matching';
import { getTickSize, isValidTick } from './tickSize';
import { stopBotEngine } from './botEngine';
import { seedBrokers } from './seedBrokers';
import { initBrokerPool } from './matching';

async function runTests() {
  console.log('Starting matching engine tests...');
  
  // Stop bot engine to prevent interference with tests
  stopBotEngine();
  // Brief pause to let any in-flight bot loop finish
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Cleanup DB first (preserve system bot users + player)
  const preservedEmails = [
    'systembot.regular@bursasimulasi.internal',
    'systembot.institution@bursasimulasi.internal',
    'systembot.algo@bursasimulasi.internal',
    'player@bursasimulasi.com',
  ];
  await prisma.trade.deleteMany();
  await prisma.realizedTrade.deleteMany();
  await prisma.equitySnapshot.deleteMany();
  await prisma.bot.deleteMany();
  await prisma.order.deleteMany();
  await prisma.portfolio.deleteMany();
  await prisma.user.deleteMany({
    where: {
      email: { notIn: preservedEmails },
    },
  });

  // Seed brokers (idempotent) + init in-memory pool for matching
  await seedBrokers();
  await initBrokerPool();

  // 1. Setup Test Data
  const stock = await prisma.stock.findFirst();
  if (!stock) throw new Error('No stocks found in DB. Run seeder first.');

  // Create two users for testing
  const buyer = await prisma.user.create({
    data: {
      email: `buyer_${Date.now()}@test.com`,
      passwordHash: 'hashed',
      cashBalance: 100000000 // 100M
    }
  });

  const seller = await prisma.user.create({
    data: {
      email: `seller_${Date.now()}@test.com`,
      passwordHash: 'hashed',
      cashBalance: 0
    }
  });

  // Give seller some stock
  await prisma.portfolio.create({
    data: {
      userId: seller.id,
      stockId: stock.id,
      quantity: 1000,
      avgPrice: 1000
    }
  });

  // ── Test 1: Limit Order placement (No Match) ──────────────────────────────
  console.log('✓ Test 1: Limit order placement (no match)...');
  const sellOrder = await placeOrder({
    userId: seller.id,
    stockId: stock.id,
    side: 'OFFER',
    price: Number(stock.lastPrice) + 100,
    quantity: 100,
    type: 'LIMIT'
  });

  assert.strictEqual(sellOrder.incomingOrder.status, 'OPEN');
  assert.strictEqual(sellOrder.executedQty, 0);

  const sellerPortfolio = await prisma.portfolio.findUnique({ where: { userId_stockId: { userId: seller.id, stockId: stock.id } } });
  assert.strictEqual(sellerPortfolio?.quantity, 900);

  // ── Test 2: Order Match (Buyer hits seller's offer) ───────────────────────
  console.log('✓ Test 2: Order matching (full fill)...');
  const buyOrder = await placeOrder({
    userId: buyer.id,
    stockId: stock.id,
    side: 'BID',
    price: Number(stock.lastPrice) + 100,
    quantity: 100,
    type: 'LIMIT'
  });

  assert.strictEqual(buyOrder.executedQty, 100);
  assert.strictEqual(buyOrder.executedTrades[0].type, 'MATCH');
  const finalBuyOrder = await prisma.order.findUnique({ where: { id: buyOrder.incomingOrder.id } });
  assert.strictEqual(finalBuyOrder?.status, 'FILLED');

  const updatedSeller = await prisma.user.findUnique({ where: { id: seller.id } });
  const expectedProceeds = 100 * (Number(stock.lastPrice) + 100);
  assert.strictEqual(Number(updatedSeller?.cashBalance), expectedProceeds);

  const buyerPortfolio = await prisma.portfolio.findUnique({ where: { userId_stockId: { userId: buyer.id, stockId: stock.id } } });
  assert.strictEqual(buyerPortfolio?.quantity, 100);
  
  const updatedBuyer = await prisma.user.findUnique({ where: { id: buyer.id } });
  const expectedBuyerCash = 100000000 - expectedProceeds;
  assert.strictEqual(Number(updatedBuyer?.cashBalance), expectedBuyerCash);

  const updatedSellOrder = await prisma.order.findUnique({ where: { id: sellOrder.incomingOrder.id } });
  assert.strictEqual(updatedSellOrder?.remainingQuantity, 0);
  assert.strictEqual(updatedSellOrder?.status, 'FILLED');

  // ── Test 3: HAKA (market buy) ────────────────────────────────────────────
  console.log('✓ Test 3: HAKA (market buy)...');
  // Reset buyer balance
  await prisma.user.update({ where: { id: buyer.id }, data: { cashBalance: 100000000 } });
  await prisma.portfolio.update({ where: { userId_stockId: { userId: seller.id, stockId: stock.id } }, data: { quantity: { increment: 200 } } });

  const hakaSellSetup = await placeOrder({
    userId: seller.id, stockId: stock.id, side: 'OFFER',
    price: Number(stock.lastPrice) + 50, quantity: 100, type: 'LIMIT'
  });
  assert.strictEqual(hakaSellSetup.executedQty, 0);

  const buyerBeforeHaka = await prisma.user.findUnique({ where: { id: buyer.id } });
  const hakaResult = await placeOrder({
    userId: buyer.id, stockId: stock.id, side: 'BID',
    price: 1, quantity: 100, type: 'HAKA'
  });
  assert.strictEqual(hakaResult.executedQty, 100, 'HAKA should fully fill against the resting offer');
  assert.strictEqual(hakaResult.executedTrades[0].type, 'HAKA');

  const buyerAfterHaka = await prisma.user.findUnique({ where: { id: buyer.id } });
  const expectedCost = 100 * (Number(stock.lastPrice) + 50);
  const actualCost = Number(buyerBeforeHaka!.cashBalance) - Number(buyerAfterHaka!.cashBalance);
  assert.strictEqual(actualCost, expectedCost, `HAKA should charge the real book price (${expectedCost}), got ${actualCost}`);

  // ── Test 4: HAKI (market sell) ───────────────────────────────────────────
  console.log('✓ Test 4: HAKI (market sell)...');
  // Give buyer stock for selling
  await prisma.portfolio.upsert({
    where: { userId_stockId: { userId: buyer.id, stockId: stock.id } },
    update: { quantity: { increment: 500 } },
    create: { userId: buyer.id, stockId: stock.id, quantity: 500, avgPrice: Number(stock.lastPrice) }
  });
  await prisma.user.update({ where: { id: seller.id }, data: { cashBalance: 50000000 } });

  // Place a resting bid for HAKI to hit
  const hakiBidSetup = await placeOrder({
    userId: seller.id, stockId: stock.id, side: 'BID',
    price: Number(stock.lastPrice) - 50, quantity: 200, type: 'LIMIT'
  });
  assert.strictEqual(hakiBidSetup.executedQty, 0);

  // HAKI: seller placed BID (maker), should have received 100 shares
  const sellerPortfolioBeforeHaki = await prisma.portfolio.findUnique({
    where: { userId_stockId: { userId: seller.id, stockId: stock.id } }
  });

  const sellerBeforeHaki = await prisma.user.findUnique({ where: { id: seller.id } });
  const hakiResult = await placeOrder({
    userId: buyer.id, stockId: stock.id, side: 'OFFER',
    price: 999999, quantity: 100, type: 'HAKI'
  });
  assert.strictEqual(hakiResult.executedQty, 100, 'HAKI should fully fill against the resting bid');
  assert.strictEqual(hakiResult.executedTrades[0].type, 'HAKI');

  const sellerPortfolioAfterHaki = await prisma.portfolio.findUnique({
    where: { userId_stockId: { userId: seller.id, stockId: stock.id } }
  });
  assert.strictEqual(
    sellerPortfolioAfterHaki!.quantity,
    Number(sellerPortfolioBeforeHaki!.quantity) + 100,
    'HAKI: maker (seller BID) should receive 100 shares'
  );

  // ── Test 5: Tick Size Validation ──────────────────────────────────────────
  console.log('✓ Test 5: Tick size validation...');
  // Verify tick size brackets
  assert.strictEqual(getTickSize(50), 1);   // < 200 → tick 1
  assert.strictEqual(getTickSize(200), 2);   // 200-500 → tick 2
  assert.strictEqual(getTickSize(500), 5);   // 500-2000 → tick 5
  assert.strictEqual(getTickSize(2000), 10); // 2000-5000 → tick 10
  assert.strictEqual(getTickSize(5000), 25); // >= 5000 → tick 25

  // Valid ticks
  assert.strictEqual(isValidTick(100), true);   // 100 % 1 === 0
  assert.strictEqual(isValidTick(102), true);   // 102 % 2 === 0
  assert.strictEqual(isValidTick(1500), true);  // 1500 % 5 === 0
  assert.strictEqual(isValidTick(3000), true);  // 3000 % 10 === 0
  assert.strictEqual(isValidTick(8250), true);  // 8250 % 25 === 0

  // Invalid ticks
  assert.strictEqual(isValidTick(203), false);  // 203 % 2 !== 0
  assert.strictEqual(isValidTick(1503), false); // 1503 % 5 !== 0
  assert.strictEqual(isValidTick(3005), false); // 3005 % 10 !== 0
  assert.strictEqual(isValidTick(8260), false); // 8260 % 25 !== 0

  // ── Test 6: Invalid tick rejection ────────────────────────────────────────
  console.log('✓ Test 6: Invalid tick rejection...');
  await prisma.user.update({ where: { id: buyer.id }, data: { cashBalance: 100000000 } });
  await prisma.portfolio.update({
    where: { userId_stockId: { userId: seller.id, stockId: stock.id } },
    data: { quantity: 1000 }
  });

  // Try placing LIMIT order with invalid tick (if stock.lastPrice > 5000, use 5001)
  let tickError: string | null = null;
  try {
    const testPrice = getTickSize(Number(stock.lastPrice)) === 25 ? Number(stock.lastPrice) + 1 :
                      getTickSize(Number(stock.lastPrice)) === 10 ? Number(stock.lastPrice) + 3 :
                      getTickSize(Number(stock.lastPrice)) === 5 ? Number(stock.lastPrice) + 2 :
                      Number(stock.lastPrice) + 1; // custom invalid offset
    await placeOrder({
      userId: buyer.id, stockId: stock.id, side: 'BID',
      price: testPrice, quantity: 100, type: 'LIMIT'
    });
  } catch (err: any) {
    tickError = err.message;
  }
  assert.ok(tickError?.includes('Invalid tick'), `Should reject invalid tick: ${tickError}`);

  // ── Test 7: Multi-level matching ──────────────────────────────────────────
  console.log('✓ Test 7: Multi-level matching (sweep multiple price levels)...');
  // Reset
  await prisma.trade.deleteMany({ where: { stockId: stock.id } });
  await prisma.order.deleteMany({ where: { stockId: stock.id } });
  await prisma.portfolio.update({
    where: { userId_stockId: { userId: seller.id, stockId: stock.id } },
    data: { quantity: 1000 }
  });
  await prisma.user.update({ where: { id: buyer.id }, data: { cashBalance: 100000000 } });

  const tick = getTickSize(Number(stock.lastPrice));
  // Place 3 offer levels
  await placeOrder({ userId: seller.id, stockId: stock.id, side: 'OFFER', price: Number(stock.lastPrice) + tick, quantity: 100, type: 'LIMIT' });
  await placeOrder({ userId: seller.id, stockId: stock.id, side: 'OFFER', price: Number(stock.lastPrice) + tick * 2, quantity: 100, type: 'LIMIT' });
  await placeOrder({ userId: seller.id, stockId: stock.id, side: 'OFFER', price: Number(stock.lastPrice) + tick * 3, quantity: 100, type: 'LIMIT' });

  // HAKA sweeps all 3 levels (300 shares)
  const sweepResult = await placeOrder({
    userId: buyer.id, stockId: stock.id, side: 'BID',
    price: 1, quantity: 300, type: 'HAKA'
  });
  assert.strictEqual(sweepResult.executedQty, 300, 'HAKA should sweep all 3 offer levels');
  assert.strictEqual(sweepResult.executedTrades.length, 3, 'Should have 3 separate trades');

  // ── Test 8: Insufficient balance rejection ─────────────────────────────────
  console.log('✓ Test 8: Insufficient balance rejection...');
  let balanceError: string | null = null;
  try {
    // Use lastPrice (always within ARA/ARB) with huge quantity to exceed cash
    await placeOrder({
      userId: buyer.id, stockId: stock.id, side: 'BID',
      price: Number(stock.lastPrice), quantity: 50000, type: 'LIMIT'
    });
  } catch (err: any) {
    balanceError = err.message;
  }
  assert.ok(balanceError?.includes('Insufficient'), `Should reject insufficient balance: ${balanceError}`);

  // ── Test 9: Insufficient stock rejection ──────────────────────────────────
  console.log('✓ Test 9: Insufficient stock rejection...');
  let stockError: string | null = null;
  try {
    await placeOrder({
      userId: buyer.id, stockId: stock.id, side: 'OFFER',
      price: Number(stock.lastPrice), quantity: 999900, type: 'LIMIT'
    });
  } catch (err: any) {
    stockError = err.message;
  }
  assert.ok(stockError?.includes('Insufficient stock'), `Should reject insufficient stock: ${stockError}`);

  // ── Test 10: Weighted average avgPrice ─────────────────────────────────────
  console.log('✓ Test 10: Weighted average avgPrice...');
  // Use lastPrice (guaranteed valid tick and within ARA/ARB) plus an offset
  const basePrice = Number(stock.lastPrice);
  const tickSz = getTickSize(basePrice);
  const price1 = basePrice;
  const price2 = basePrice + tickSz * 5; // 5 ticks above, still within ARA/ARB
  assert.ok(price2 > price1, `price2 ${price2} must be > price1 ${price1}`);
  // Setup: user buys 100 shares at 1000, then 100 more at 2000
  // Expected avgPrice = (100*1000 + 100*2000) / 200 = 1500
  const avgTestUser = await prisma.user.create({
    data: { email: `avgtest_${Date.now()}@test.com`, passwordHash: 'hashed', cashBalance: 100000000 }
  });
  const avgTestSeller = await prisma.user.create({
    data: { email: `avgseller_${Date.now()}@test.com`, passwordHash: 'hashed', cashBalance: 0 }
  });
  // Give seller 1000 shares initially
  await prisma.portfolio.create({
    data: { userId: avgTestSeller.id, stockId: stock.id, quantity: 1000, avgPrice: 800 }
  });

  // Price level 1: seller places OFFER at price1 for 100 shares
  await placeOrder({
    userId: avgTestSeller.id, stockId: stock.id, side: 'OFFER',
    price: price1, quantity: 100, type: 'LIMIT'
  });
  // Buyer buys 100 at price1
  await placeOrder({
    userId: avgTestUser.id, stockId: stock.id, side: 'BID',
    price: price1, quantity: 100, type: 'LIMIT'
  });
  let avgPort = await prisma.portfolio.findUnique({
    where: { userId_stockId: { userId: avgTestUser.id, stockId: stock.id } }
  });
  assert.strictEqual(avgPort?.quantity, 100, 'After 1st buy: qty should be 100');
  assert.strictEqual(Number(avgPort?.avgPrice), price1, `After 1st buy: avgPrice should be ${price1}`);

  // Price level 2: seller places OFFER at price2 for 100 shares
  await prisma.portfolio.update({
    where: { userId_stockId: { userId: avgTestSeller.id, stockId: stock.id } },
    data: { quantity: 1000 }
  });
  await placeOrder({
    userId: avgTestSeller.id, stockId: stock.id, side: 'OFFER',
    price: price2, quantity: 100, type: 'LIMIT'
  });
  // Buyer buys 100 more at price2
  await placeOrder({
    userId: avgTestUser.id, stockId: stock.id, side: 'BID',
    price: price2, quantity: 100, type: 'LIMIT'
  });
  avgPort = await prisma.portfolio.findUnique({
    where: { userId_stockId: { userId: avgTestUser.id, stockId: stock.id } }
  });
  assert.strictEqual(avgPort?.quantity, 200, 'After 2nd buy: qty should be 200');
  const expectedAvg = Math.round((100 * price1 + 100 * price2) / 200);
  assert.strictEqual(Number(avgPort?.avgPrice), expectedAvg, `After 2nd buy: avgPrice should be ${expectedAvg} (weighted avg)`);

  // Cleanup test 10 users
  await prisma.trade.deleteMany({ where: { stockId: stock.id } });
  await prisma.order.deleteMany({ where: { stockId: stock.id } });
  await prisma.realizedTrade.deleteMany({ where: { userId: { in: [avgTestUser.id, avgTestSeller.id] } } });
  await prisma.equitySnapshot.deleteMany({ where: { userId: { in: [avgTestUser.id, avgTestSeller.id] } } });
  await prisma.portfolio.deleteMany({ where: { userId: { in: [avgTestUser.id, avgTestSeller.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [avgTestUser.id, avgTestSeller.id] } } });

  // ── Test 11: LIMIT order above ARA must reject ────────────────────────────
  console.log('✓ Test 11: LIMIT order above ARA must reject...');
  // Ensure stock has ARA/ARB values
  const testStock = await prisma.stock.findFirst();
  if (!testStock) throw new Error('No stock in DB');
  const { computeAraArb } = await import('./araArb');
  const { araPrice, arbPrice } = computeAraArb(testStock.lastPrice);
  await prisma.stock.update({
    where: { id: testStock.id },
    data: { previousClose: testStock.lastPrice, referencePrice: testStock.lastPrice, araPrice, arbPrice },
  });

  let araError: string | null = null;
  const { getTickSize: ts } = await import('./tickSize');
  await prisma.user.update({ where: { id: buyer.id }, data: { cashBalance: 100000000 } });
  try {
    await placeOrder({
      userId: buyer.id,
      stockId: testStock.id,
      side: 'BID',
      price: araPrice + ts(araPrice), // 1 tick di atas ARA (valid tick)
      quantity: 100,
      type: 'LIMIT',
    });
  } catch (err: any) {
    araError = err.message;
  }
  assert.ok(araError?.toLowerCase().includes('ara'), `Should reject above ARA with 'ARA' in message, got: ${araError}`);

  // ── Test 12: LIMIT order within ARA/ARB must succeed ──────────────────────
  console.log('✓ Test 12: LIMIT order within ARA/ARB must succeed...');
  await prisma.user.update({ where: { id: buyer.id }, data: { cashBalance: 100000000 } });
  // Use lastPrice (guaranteed within ARA/ARB since it's the reference)
  const validOrder = await placeOrder({
    userId: buyer.id,
    stockId: testStock.id,
    side: 'BID',
    price: testStock.lastPrice,
    quantity: 100,
    type: 'LIMIT',
  });
  assert.strictEqual(validOrder.executedQty, 0, 'LIMIT inside ARA/ARB should be accepted');
  assert.strictEqual(validOrder.incomingOrder.status, 'OPEN', 'Should be OPEN when no match');

  console.log('\n🎉 All 12 matching engine tests passed!');

  // Cleanup
  await prisma.trade.deleteMany({ where: { stockId: stock.id } });
  await prisma.order.deleteMany({ where: { stockId: stock.id } });
  await prisma.realizedTrade.deleteMany({ where: { userId: { in: [buyer.id, seller.id] } } });
  await prisma.equitySnapshot.deleteMany({ where: { userId: { in: [buyer.id, seller.id] } } });
  await prisma.portfolio.deleteMany({ where: { userId: { in: [buyer.id, seller.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [buyer.id, seller.id] } } });
}

runTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
