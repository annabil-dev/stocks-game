import { PrismaClient } from '@prisma/client';
import yahooFinance from 'yahoo-finance2';

const prisma = new PrismaClient();

const TOP_STOCKS = [
  'BBCA.JK', 'BBRI.JK', 'BMRI.JK', 'TLKM.JK', 'ASII.JK',
  'GOTO.JK', 'AMMN.JK', 'BBNI.JK', 'UNVR.JK', 'ICBP.JK',
  'KLBF.JK', 'MDKA.JK', 'ADRO.JK', 'PTBA.JK', 'INDF.JK',
  'CPIN.JK', 'PGAS.JK', 'UNTR.JK', 'SMGR.JK', 'BRPT.JK'
];

export async function seedDatabase() {
  console.log('Checking if database needs seeding...');
  
  const seedConfig = await prisma.systemConfig.findUnique({
    where: { key: 'is_seeded' }
  });

  if (seedConfig && seedConfig.value === 'true') {
    console.log('Database already seeded. Skipping.');
    return;
  }

  console.log('Fetching top 20 IHSG stocks from Yahoo Finance...');
  
  for (const ticker of TOP_STOCKS) {
    try {
      const quote = await yahooFinance.quote(ticker);
      
      const price = quote.regularMarketPrice || quote.previousClose;
      if (!price) {
        console.warn(`Could not find price for ${ticker}, skipping.`);
        continue;
      }
      
      await prisma.stock.upsert({
        where: { ticker },
        update: {
          name: quote.shortName || ticker,
        },
        create: {
          ticker,
          name: quote.shortName || ticker,
          initialPrice: price,
          lastPrice: price,
          isSeeded: true
        }
      });
      console.log(`Seeded ${ticker} with price ${price}`);
    } catch (error) {
      console.error(`Failed to seed ${ticker}:`, error);
    }
  }

  await prisma.systemConfig.upsert({
    where: { key: 'is_seeded' },
    update: { value: 'true' },
    create: { key: 'is_seeded', value: 'true' }
  });

  console.log('Seeding completed successfully.');
}

seedDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
