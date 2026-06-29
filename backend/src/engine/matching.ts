import { io } from '../index';
import { prisma } from '../db';
import { isValidTick } from './tickSize';
import { Prisma } from '@prisma/client';
import { marketEvents, MarketEventType, eventManager } from './eventManager';
import { checkAraArb, clampToAraArb } from './araArb';

// ── In-memory broker pool ──────────────────────────────────
let brokerPool: string[] = [];

export async function initBrokerPool() {
  const brokers = await prisma.broker.findMany({ select: { id: true } });
  brokerPool = brokers.map(b => b.id);
}

// Pick a random broker (fallback to undefined if pool empty)
function randomBrokerId(): string | undefined {
  if (brokerPool.length === 0) return undefined;
  return brokerPool[Math.floor(Math.random() * brokerPool.length)];
}

export type OrderType = 'LIMIT' | 'HAKA' | 'HAKI';

export interface PlaceOrderPayload {
  userId: string;
  stockId: string;
  side: 'BID' | 'OFFER';
  price: number;
  quantity: number;
  type: OrderType;
}

export async function placeOrder(payload: PlaceOrderPayload) {
  const { userId, stockId, side, price, quantity, type } = payload;

  if (quantity < 100) {
    throw new Error('Minimum order is 1 lot (100 lembar).');
  }
  if (quantity % 100 !== 0) {
    throw new Error('Order quantity must be in multiples of 1 lot (100 lembar).');
  }

  if (type === 'LIMIT' && !isValidTick(price)) {
    throw new Error('Invalid tick size for the given price.');
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Get User Balance & Portfolio
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const stock = await tx.stock.findUniqueOrThrow({ where: { id: stockId } });

    // ── ARA/ARB enforcement ──
    const araPrice = stock.araPrice || 0;
    const arbPrice = stock.arbPrice || 0;
    if (araPrice > 0 && arbPrice > 0 && type === 'LIMIT') {
      const check = checkAraArb(price, araPrice, arbPrice);
      if (!check.valid) throw new Error(check.reason!);
    }

    // Ensure we don't have race conditions by relying on transaction isolation (SQLite serializes this).
    // In Postgres, we'd use SELECT ... FOR UPDATE here.

    // Tracks how much cash was actually locked for a BID order (relevant for HAKA refund logic below).
    let lockPrice = price;
    // Tracks seller's avgPrice for RealizedTrade creation (set when side === 'OFFER')
    let takerSellerAvgPrice = 0;

    if (side === 'BID') {
      // For LIMIT orders, the price ceiling is whatever the user specified.
      // For HAKA (market buy), the client-supplied `price` is NOT trustworthy as a cost basis —
      // it may be stale (e.g. last price at page load) while the real book has moved.
      // Instead, estimate the worst-case cost by walking the current offer book up to `quantity`.
      if (type === 'HAKA') {
        const offerLevels = await tx.order.findMany({
          where: { stockId, side: 'OFFER', status: { in: ['OPEN', 'PARTIAL'] } },
          orderBy: [{ price: 'asc' }, { createdAt: 'asc' }],
        });
        let qtyLeft = quantity;
        let worstPrice = Number(stock.lastPrice);
        for (const lvl of offerLevels) {
          if (qtyLeft <= 0) break;
          worstPrice = Number(lvl.price);
          qtyLeft -= lvl.remainingQuantity;
        }
        // If the book doesn't have enough depth to fill the whole order,
        // pad with a safety margin above the worst level seen so the lock doesn't undershoot.
        lockPrice = qtyLeft > 0 ? Math.ceil(worstPrice * 1.1) : worstPrice;
        // Clamp lockPrice to ARA — HAKA buy cannot exceed upper daily limit
        if (araPrice > 0) lockPrice = Math.min(lockPrice, araPrice);
      }

      const requiredCash = lockPrice * quantity;
      if (Number(user.cashBalance) < requiredCash) {
        throw new Error('Insufficient cash balance.');
      }
      // Hold cash by deducting it now. (Unused cash is returned if cancelled, or refunded if filled cheaper)
      await tx.user.update({
        where: { id: userId },
        data: { cashBalance: { decrement: requiredCash } }
      });
    } else {
      const portfolio = await tx.portfolio.findUnique({
        where: { userId_stockId: { userId, stockId } }
      });
      if (!portfolio || portfolio.quantity < quantity) {
        throw new Error('Insufficient stock quantity in portfolio.');
      }
      // Hold stock by deducting it now.
      await tx.portfolio.update({
        where: { id: portfolio.id },
        data: { quantity: { decrement: quantity } }
      });
      // Save seller's avgPrice BEFORE decrement for RealizedTrade
      takerSellerAvgPrice = Number(portfolio.avgPrice);
    }

    // 2. Create the incoming order
    // For HAKA, store the estimated lockPrice (not the client's possibly-stale price) so order
    // history/refund math stays consistent with what was actually reserved.
    const recordedPrice = type === 'HAKA' ? lockPrice : price;
    const incomingOrder = await tx.order.create({
      data: {
        userId,
        stockId,
        side,
        price: recordedPrice,
        quantity,
        remainingQuantity: quantity,
        status: 'OPEN', // Will be finalized in step 5 based on fill outcome
        brokerId: randomBrokerId(),
      }
    });

    let remainingQty = quantity;
    let currentLastPrice = Number(stock.lastPrice);
    const lastPriceBeforeUpdate = currentLastPrice;
    const executedTrades: { price: number; quantity: number; type: string ; buyOrderId?: string; sellOrderId?: string }[] = [];

    // 3. Find opposing orders in the book
    const opposingSide = side === 'BID' ? 'OFFER' : 'BID';
    const orderDirection = side === 'BID' ? 'asc' : 'desc'; // For Buy, match lowest offer. For Sell, match highest bid.

    // Get OPEN or PARTIAL opposing orders, sorted by price priority, then by time (FIFO)
    const opposingOrders = await tx.order.findMany({
      where: {
        stockId,
        side: opposingSide,
        status: { in: ['OPEN', 'PARTIAL'] },
        // For LIMIT, filter by price condition
        ...(type === 'LIMIT' && side === 'BID' ? { price: { lte: price } } : {}),
        ...(type === 'LIMIT' && side === 'OFFER' ? { price: { gte: price } } : {})
      },
      orderBy: [
        { price: orderDirection },
        { createdAt: 'asc' }
      ]
    });

    // 4. Match
    for (const opp of opposingOrders) {
      if (remainingQty <= 0) break;

      const oppRemaining = opp.remainingQuantity;
      const matchQty = Math.min(remainingQty, oppRemaining);
      const matchPrice = Number(opp.price); // Execution always happens at the maker's (book) price

      // ── ARA/ARB sweep limit for HAKA/HAKI ──
      // Stop sweeping if next match price exceeds daily limit. Remainder becomes LIMIT (handled below).
      if (araPrice > 0 && arbPrice > 0 && type !== 'LIMIT') {
        if (side === 'BID' && matchPrice > araPrice) break; // HAKA hit ARA ceiling
        if (side === 'OFFER' && matchPrice < arbPrice) break; // HAKI hit ARB floor
      }

      // Execute Trade
      await tx.trade.create({
        data: {
          stockId,
          buyOrderId: side === 'BID' ? incomingOrder.id : opp.id,
          sellOrderId: side === 'OFFER' ? incomingOrder.id : opp.id,
          price: matchPrice,
          quantity: matchQty,
          type: type === 'LIMIT' ? 'MATCH' : type
        }
      });
      executedTrades.push({
        price: matchPrice,
        quantity: matchQty,
        type: type === 'LIMIT' ? 'MATCH' : type,
        buyOrderId: side === 'BID' ? incomingOrder.id : opp.id,
        sellOrderId: side === 'OFFER' ? incomingOrder.id : opp.id,
      });

      // Update remaining quantities
      remainingQty -= matchQty;
      const oppNewRemaining = oppRemaining - matchQty;
      
      // Update maker order
      await tx.order.update({
        where: { id: opp.id },
        data: {
          remainingQuantity: oppNewRemaining,
          status: oppNewRemaining === 0 ? 'FILLED' : 'PARTIAL'
        }
      });

      // Settle balances for the MATCH
      const tradeValue = matchQty * matchPrice;
      
      // Maker (Opposing side)
      if (opposingSide === 'BID') {
        // Opposing was BID (buying). They already locked cash at their bid price.
        // They get the stock → update avgPrice with weighted average.
        const makerPort = await tx.portfolio.findUnique({
          where: { userId_stockId: { userId: opp.userId, stockId } },
          select: { quantity: true, avgPrice: true },
        });
        const makerOldQty = makerPort?.quantity ?? 0;
        const makerOldAvg = makerPort?.avgPrice ?? 0;
        const makerNewQty = makerOldQty + matchQty;
        const makerNewAvg = makerNewQty > 0
          ? Math.round((makerOldQty * makerOldAvg + matchQty * matchPrice) / makerNewQty)
          : matchPrice;

        await tx.portfolio.upsert({
          where: { userId_stockId: { userId: opp.userId, stockId } },
          update: { quantity: { increment: matchQty }, avgPrice: makerNewAvg },
          create: { userId: opp.userId, stockId, quantity: matchQty, avgPrice: matchPrice }
        });
      } else {
        // Opposing was OFFER (selling). They already locked stock.
        // They get cash.
        await tx.user.update({
          where: { id: opp.userId },
          data: { cashBalance: { increment: tradeValue } }
        });
        // RealizedTrade: maker sell
        const makerSellPort = await tx.portfolio.findUnique({
          where: { userId_stockId: { userId: opp.userId, stockId } },
          select: { avgPrice: true },
        });
        const makerBuyPrice = Number(makerSellPort?.avgPrice ?? 0);
        if (makerBuyPrice > 0) {
          await tx.realizedTrade.create({
            data: {
              userId: opp.userId,
              stockId,
              quantity: matchQty,
              buyPrice: makerBuyPrice,
              sellPrice: matchPrice,
              profitLoss: (matchPrice - makerBuyPrice) * matchQty,
            }
          });
        }
      }

      // Taker (Incoming side)
      if (side === 'BID') {
        // Taker is BUYING. They already locked cash at their limit price (or market price which is risky).
        // Taker gets stock → update avgPrice with weighted average.
        const takerPort = await tx.portfolio.findUnique({
          where: { userId_stockId: { userId, stockId } },
          select: { quantity: true, avgPrice: true },
        });
        const takerOldQty = takerPort?.quantity ?? 0;
        const takerOldAvg = takerPort?.avgPrice ?? 0;
        const takerNewQty = takerOldQty + matchQty;
        const takerNewAvg = takerNewQty > 0
          ? Math.round((takerOldQty * takerOldAvg + matchQty * matchPrice) / takerNewQty)
          : matchPrice;

        await tx.portfolio.upsert({
          where: { userId_stockId: { userId, stockId } },
          update: { quantity: { increment: matchQty }, avgPrice: takerNewAvg },
          create: { userId, stockId, quantity: matchQty, avgPrice: matchPrice }
        });
        
        // If the taker locked more cash per share than the actual match price, refund the difference.
        // Applies to LIMIT (locked at their specified ceiling) and HAKA (locked at estimated worst-case price).
        if (lockPrice > matchPrice) {
          const refund = matchQty * (lockPrice - matchPrice);
          await tx.user.update({
            where: { id: userId },
            data: { cashBalance: { increment: refund } }
          });
        }
      } else {
        // Taker is SELLING. They already locked stock.
        // Taker gets cash.
        await tx.user.update({
          where: { id: userId },
          data: { cashBalance: { increment: tradeValue } }
        });
        // RealizedTrade: taker sell
        if (takerSellerAvgPrice > 0) {
          await tx.realizedTrade.create({
            data: {
              userId,
              stockId,
              quantity: matchQty,
              buyPrice: takerSellerAvgPrice,
              sellPrice: matchPrice,
              profitLoss: (matchPrice - takerSellerAvgPrice) * matchQty,
            }
          });
        }
      }

      currentLastPrice = matchPrice;
    }

    // 5. Finalize Taker Order
    if (remainingQty === 0) {
      await tx.order.update({
        where: { id: incomingOrder.id },
        data: { remainingQuantity: 0, status: 'FILLED' }
      });
    } else {
      if (type === 'LIMIT') {
        await tx.order.update({
          where: { id: incomingOrder.id },
          data: { remainingQuantity: remainingQty, status: remainingQty === quantity ? 'OPEN' : 'PARTIAL' }
        });
      } else {
        // ── HAKA/HAKI: unfilled remainder → LIMIT order at last matched price ──
        // IDX rule: HAKA sisa → jadi LIMIT BID di harga match terakhir.
        //           HAKI sisa → jadi LIMIT OFFER di harga match terakhir.
        const anyMatched = remainingQty < quantity;
        if (anyMatched) {
          const limitPrice = currentLastPrice; // last execution price
          if (type === 'HAKA') {
            // Remaining becomes LIMIT BID at last match price
            await tx.order.update({
              where: { id: incomingOrder.id },
              data: {
                remainingQuantity: remainingQty,
                status: 'PARTIAL',
                price: limitPrice,
              }
            });
            // Refund excess locked cash (locked at lockPrice, now resting at limitPrice)
            if (lockPrice > limitPrice) {
              const refund = remainingQty * (lockPrice - limitPrice);
              await tx.user.update({
                where: { id: userId },
                data: { cashBalance: { increment: refund } }
              });
            }
          } else {
            // HAKI: remaining becomes LIMIT OFFER at last match price
            await tx.order.update({
              where: { id: incomingOrder.id },
              data: {
                remainingQuantity: remainingQty,
                status: 'PARTIAL',
                price: limitPrice,
              }
            });
          }
        } else {
          // No matches at all — cancel and refund (book was empty)
          await tx.order.update({
            where: { id: incomingOrder.id },
            data: { remainingQuantity: remainingQty, status: 'CANCELLED' }
          });
          if (side === 'BID') {
            const refund = remainingQty * lockPrice;
            await tx.user.update({
              where: { id: userId },
              data: { cashBalance: { increment: refund } }
            });
          } else {
            await tx.portfolio.update({
              where: { userId_stockId: { userId, stockId } },
              data: { quantity: { increment: remainingQty } }
            });
          }
        }
      }
    }

    // 6. Update Stock Last Price (inside transaction, but emit happens after commit)
    const priceChanged = currentLastPrice !== Number(stock.lastPrice);
    if (priceChanged) {
      await tx.stock.update({
        where: { id: stockId },
        data: { lastPrice: currentLastPrice }
      });
    }

    return {
      incomingOrder,
      currentLastPrice,
      lastPriceBeforeUpdate,
      executedQty: quantity - remainingQty,
      priceChanged,
      executedTrades,
      stockTicker: stock.ticker,
    };
  });

  // ── Emit events via EventManager (in-process pub/sub for AlgoEngine) ────
  // Also broadcast via WebSocket for frontend clients.
  const now = new Date().toISOString();

  if (result.priceChanged) {
    io.to(`stock:${stockId}`).emit('lastPrice', {
      stockId,
      price: result.currentLastPrice,
      timestamp: now,
    });
  }

  for (const t of result.executedTrades) {
    // Emit ORDER_MATCHED event for AlgoEngine
    marketEvents.emit({
      type: MarketEventType.ORDER_MATCHED,
      stockId,
      timestamp: now,
      buyOrderId: t.buyOrderId ?? '',
      sellOrderId: t.sellOrderId ?? '',
      matchPrice: t.price,
      matchQuantity: t.quantity,
    });

    // Emit TRADE_EXECUTED event for AlgoEngine
    marketEvents.emit({
      type: MarketEventType.TRADE_EXECUTED,
      stockId,
      timestamp: now,
      price: t.price,
      quantity: t.quantity,
      tradeType: t.type,
    });

    // Broadcast trade to frontend
    io.to(`stock:${stockId}`).emit('trade', {
      stockId,
      price: t.price,
      quantity: t.quantity,
      type: t.type,
      executedAt: now,
    });

    // Global broadcast for All Stocks flash animation
    io.emit('all:trade', {
      stockId,
      ticker: result.stockTicker,
      price: Number(t.price),
      quantity: t.quantity,
      tradeType: t.type, // 'MATCH' | 'HAKA' | 'HAKI'
    });
  }

  // Emit ORDERBOOK_UPDATED event for AlgoEngine
  marketEvents.emit({
    type: MarketEventType.ORDERBOOK_UPDATED,
    stockId,
    timestamp: now,
  });

  // Inform frontend clients to refetch order book depth
  io.to(`stock:${stockId}`).emit('orderbook:update', { stockId });

  return result;
}
