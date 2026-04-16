require('dotenv').config();
const { installGlobalConsoleTimestamping } = require('./src/utils/logger');
installGlobalConsoleTimestamping();

const config = require('./src/config');
const { query } = require('./src/db/pool');
const { runMigrations } = require('./src/db/migrations');
const { seedMasterUser } = require('./src/db/seed');
const { refreshMetaSettingsCache } = require('./src/services/metaSettingsCache');
const { createApp } = require('./src/createApp');

async function boot() {
  await runMigrations(query);
  await seedMasterUser(query);
  await refreshMetaSettingsCache(query);

  const { app, resumeQueuedCampaigns } = createApp();
  await resumeQueuedCampaigns();

  app.listen(config.port, '0.0.0.0', () => {
    const suffix = config.basePath ? ` | BASE_PATH=${config.basePath}` : '';
    console.log(`Servidor listo en puerto ${config.port}${suffix}`);
  });
}

boot().catch((err) => {
  console.error(err);
  process.exit(1);
});
