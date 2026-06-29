import path from 'path';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { prisma } from './db';
import { seedDatabase } from './seeder';
import { seedBrokers } from './engine/seedBrokers';
import { initMarketScheduler } from './scheduler';
import { startAlgoEngine, getEngineStats } from './engine/algoEngine';
import { startUserBotEngine } from './engine/userBotEngine';
import { startLiquidityManager } from './engine/liquidityManager';
import routes from './routes';
import { marketEvents, MarketEventType } from './engine/eventManager';
import { initBrokerPool } from './engine/matching';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:3002',
  'https://stocks-simulations.vercel.app',
  'https://stocks-simulation-buyalce6s-annabil-hisyam-muyassar-s-projects.vercel.app',
];

export const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  }
});

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true
}));
app.use(express.json());

// Fix BigInt JSON serialization
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Serve built frontend (from /frontend/dist) as static files
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));

// API routes
app.use('/api', routes);

// SPA fallback — any non-API GET route serves index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  socket.on('subscribe', (stockId) => {
    socket.join(`stock:${stockId}`);
    console.log(`Socket ${socket.id} joined room stock:${stockId}`);
  });

  socket.on('unsubscribe', (stockId) => {
    socket.leave(`stock:${stockId}`);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3002;

/**
 * Wire up event subscriptions → WebSocket broadcasts.
 * This is the bridge between the internal event bus and Socket.IO clients.
 * No periodic broadcast loops — all updates are event-driven.
 */
function initEventSubscriptions() {
  // Broadcast any price change event to the stock's room
  marketEvents.subscribe((event) => {
    switch (event.type) {
      case MarketEventType.PRICE_CHANGED: {
        io.to(`stock:${event.stockId}`).emit('lastPrice', {
          stockId: event.stockId,
          price: event.price,
          previousPrice: event.previousPrice,
          timestamp: event.timestamp,
        });
        break;
      }

      case MarketEventType.TRADE_EXECUTED: {
        io.to(`stock:${event.stockId}`).emit('trade', {
          stockId: event.stockId,
          price: event.price,
          quantity: event.quantity,
          type: event.tradeType,
          executedAt: event.timestamp,
        });
        break;
      }

      case MarketEventType.ORDERBOOK_UPDATED: {
        io.to(`stock:${event.stockId}`).emit('orderbook:update', { stockId: event.stockId });
        break;
      }

      case MarketEventType.MARKET_STATUS: {
        io.emit('market_status', {
          status: event.status,
          timestamp: event.timestamp,
        });
        break;
      }

      case MarketEventType.ORDER_MATCHED:
      case MarketEventType.ORDER_PLACED:
      case MarketEventType.ORDER_CANCELLED:
      case MarketEventType.FOMO_TRIGGERED:
      case MarketEventType.WALL_DETECTED:
        // Reserved for future frontend features — not emitted yet
        break;

      case MarketEventType.LIQUIDITY_CHANGED:
        const lcEvent = event as any;
        io.emit('LIQUIDITY_CHANGED', {
          previousMode: lcEvent.previousMode,
          currentMode: lcEvent.currentMode,
          config: lcEvent.config,
          timestamp: event.timestamp,
        });
        break;
    }
  });

  console.log('[EventBus] Event subscriptions initialized — all broadcasts are event-driven.');
}

async function bootstrap() {
  try {
    await prisma.$connect();
    console.log('Connected to database.');
    
    await seedDatabase();
    await seedBrokers();
    initEventSubscriptions();
    await initBrokerPool();
    initMarketScheduler();
    startAlgoEngine();
    startUserBotEngine();
    startLiquidityManager();
    
    httpServer.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Only run bootstrap if this file is executed directly (not imported), e.g. by test.ts.
// `require.main === module` is the correct (and only valid) check under CommonJS.
if (require.main === module) {
  bootstrap();
}
