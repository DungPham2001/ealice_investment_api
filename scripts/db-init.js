/**
 * Creates the database, every collection (30 resources + system ones), every index, and the default public company profile.
 * Safe to re-run (also after schema changes):
 *   npm run db:init
 *   MONGODB_URI="mongodb+srv://..." npm run db:init
 * (The Vercel function turns autoIndex off, so it will not do this itself.)
 */
const mongoose = require('mongoose');
const config = require('../src/config');
require('../src/resources');
require('../src/models/system');
const { seedDefaults } = require('../src/services/content');

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log(`database: ${mongoose.connection.db.databaseName}`);
  for (const name of mongoose.modelNames()) {
    const Model = mongoose.model(name);
    await Model.createCollection().catch(() => {}); // already exists is fine
    await Model.syncIndexes();
    console.log(`  ${Model.collection.name.padEnd(24)} ${(await Model.collection.indexes()).length} indexes`);
  }
  await seedDefaults();
  console.log('company profile ok');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
