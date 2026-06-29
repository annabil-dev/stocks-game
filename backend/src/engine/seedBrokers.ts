// Dummy broker data — fictional securities names inspired by IDX naming patterns
// DO NOT use real securities names to avoid implying real institutional data.
export const BROKER_SEEDS = [
  { code: 'AK', name: 'Artha Kreasi Sekuritas' },
  { code: 'CC', name: 'Cipta Cemerlang Sekuritas' },
  { code: 'XL', name: 'Xelona Kapital Investama' },
  { code: 'GP', name: 'Garuda Perkasa Sekuritas' },
  { code: 'NS', name: 'Nusantara Sukses Sekuritas' },
  { code: 'MP', name: 'Mega Pacific Sekuritas' },
  { code: 'BS', name: 'Bumi Selaras Investama' },
  { code: 'SK', name: 'Samudra Kreasi Sekuritas' },
  { code: 'DR', name: 'Dharma Reksa Investama' },
  { code: 'SW', name: 'Sinar Wangsa Sekuritas' },
  { code: 'KA', name: 'Karya Abadi Sekuritas' },
  { code: 'LM', name: 'Lintas Mandiri Investama' },
  { code: 'PR', name: 'Prestige Reksa Sekuritas' },
  { code: 'DN', name: 'Dinamika Nusantara Sekuritas' },
  { code: 'TR', name: 'Terang Reksa Investama' },
];

import { prisma } from '../db';

export async function seedBrokers() {
  let count = 0;
  for (const b of BROKER_SEEDS) {
    const existing = await prisma.broker.findUnique({ where: { code: b.code } });
    if (!existing) {
      await prisma.broker.create({ data: b });
      count++;
    }
  }
  if (count > 0) console.log(`Seeded ${count} dummy brokers.`);
  return count;
}
