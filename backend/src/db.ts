import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  // SQLite is single-writer; under heavy bot-engine load, read queries may
  // briefly queue behind write transactions. Extend the default timeout.
  transactionOptions: {
    maxWait: 15000, // 15s max wait to acquire a connection
    timeout: 20000, // 20s transaction timeout
  },
});

// Best-effort WAL mode for better read/write concurrency on SQLite
(async () => {
  try {
    await prisma.$executeRaw`PRAGMA journal_mode = WAL`;
  } catch {
    // ignore if already WAL or unsupported
  }
})();
