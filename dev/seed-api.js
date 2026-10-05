// mongosh seed for the local ReviewForest API database (rf_shopware_dev).
// Creates one company with a read-write API key and one active forest.
//   mongosh "mongodb://localhost:27019/rf_shopware_dev?replicaSet=rs0&directConnection=true" dev/seed-api.js
// The raw API key and the forest ID are printed; put them into the app settings in the Shopware admin.
const crypto = require('crypto');

const rawApiKey = process.env.RF_DEV_API_KEY || 'rf-dev-shopware-key-0001';
const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('base64');
const companyId = ObjectId('66aa00000000000000000001');
const forestId = ObjectId('66bb00000000000000000001');

db.companies.updateOne(
  { _id: companyId },
  {
    $set: {
      name: 'Shopware Dev GmbH',
      apiKeys: [{ apiKey: apiKeyHash, name: 'shopware-dev', permissions: { scope: 'read-write', rw: true }, createdAt: new Date() }],
      updatedAt: new Date(),
    },
    $setOnInsert: { createdAt: new Date() },
  },
  { upsert: true }
);

db.forests.updateOne(
  { _id: forestId },
  {
    $set: { name: 'Shopware Dev Bewertungswald', slug: 'shopware-dev', ownedBy: companyId, active: true, type: 'single', updatedAt: new Date() },
    $setOnInsert: { createdAt: new Date(), email: { usage: 0 } },
  },
  { upsert: true }
);

print(`API key:   ${rawApiKey}`);
print(`Forest ID: ${forestId.toHexString()}`);
