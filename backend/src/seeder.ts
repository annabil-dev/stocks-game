import { prisma } from './db';

const TOP_STOCKS = [
  { ticker: 'BBCA.JK', name: 'PT Bank Central Asia Tbk', price: 5050, prevClose: 6325 },
  { ticker: 'BBRI.JK', name: 'PT Bank Rakyat Indonesia (Persero) Tbk', price: 2160, prevClose: 2850 },
  { ticker: 'BMRI.JK', name: 'PT Bank Mandiri (Persero) Tbk', price: 3050, prevClose: 4040 },
  { ticker: 'TLKM.JK', name: 'Perusahaan Perseroan (Persero) PT Telekomunikasi Indonesia Tbk', price: 1960, prevClose: 2510 },
  { ticker: 'ASII.JK', name: 'PT Astra International Tbk', price: 3590, prevClose: 4790 },
  { ticker: 'GOTO.JK', name: 'PT GoTo Gojek Tokopedia Tbk', price: 48, prevClose: 49 },
  { ticker: 'AMMN.JK', name: 'PT Amman Mineral Internasional Tbk', price: 2820, prevClose: 3290 },
  { ticker: 'BBNI.JK', name: 'PT Bank Negara Indonesia (Persero) Tbk', price: 2520, prevClose: 3340 },
  { ticker: 'UNVR.JK', name: 'PT Unilever Indonesia Tbk', price: 1310, prevClose: 1750 },
  { ticker: 'ICBP.JK', name: 'PT Indofood CBP Sukses Makmur Tbk', price: 5400, prevClose: 6575 },
  { ticker: 'KLBF.JK', name: 'PT Kalbe Farma Tbk.', price: 595, prevClose: 795 },
  { ticker: 'MDKA.JK', name: 'PT Merdeka Copper Gold Tbk', price: 2270, prevClose: 2720 },
  { ticker: 'ADRO.JK', name: 'PT Alamtri Resources Indonesia Tbk', price: 1730, prevClose: 2310 },
  { ticker: 'PTBA.JK', name: 'PT Bukit Asam (Persero) Tbk', price: 1770, prevClose: 2360 },
  { ticker: 'INDF.JK', name: 'PT Indofood Sukses Makmur Tbk', price: 5775, prevClose: 6925 },
  { ticker: 'CPIN.JK', name: 'PT Charoen Pokphand Indonesia Tbk', price: 2400, prevClose: 3190 },
  { ticker: 'PGAS.JK', name: 'PT Perusahaan Gas Negara (Persero) Tbk', price: 1165, prevClose: 1520 },
  { ticker: 'UNTR.JK', name: 'PT United Tractors Tbk', price: 18175, prevClose: 22725 },
  { ticker: 'SMGR.JK', name: 'PT Semen Indonesia (Persero) Tbk', price: 1230, prevClose: 1500 },
  { ticker: 'BRPT.JK', name: 'PT Barito Pacific Tbk', price: 1165, prevClose: 1470 },
  { ticker: 'TPIA.JK', name: 'PT Chandra Asri Pacific Tbk', price: 1370, prevClose: 1830 },
];

export async function seedDatabase() {
  console.log('Checking if database needs seeding...');
  const seedConfig = await prisma.systemConfig.findUnique({ where: { key: 'is_seeded' } });
  if (seedConfig && seedConfig.value === 'true') {
    console.log('Database already seeded. Skipping.');
    return;
  }
  console.log('Seeding stocks with real data...');
  for (const { ticker, name, price, prevClose } of TOP_STOCKS) {
    try {
      await prisma.stock.upsert({
        where: { ticker },
        update: { name, lastPrice: price, previousClose: prevClose },
        create: { ticker, name, initialPrice: price, lastPrice: price, previousClose: prevClose, isSeeded: true }
      });
      console.log(`Seeded ${ticker} at ${price}`);
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

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}
