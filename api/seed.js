import { db } from './firestore.js';

const layers = [
  'financial-analysis',
  'capital-stack',
  'ma-strategy',
  'strategic-simulation',
  'leadership-people',
  'brand-identity',
  'crisis-management',
  'operations-efficiency',
  'governance-board',
  'ai-alerts'
];

async function seed() {
  for (const layer of layers) {
    await db.collection('kpis').add({
      layer,
      title: `Sample KPI for ${layer}`,
      value: Math.floor(Math.random() * 100),
      unit: '%',
      updated: new Date().toISOString()
    });
  }
  console.log('KPI seed complete.');
}
seed();
