import express from 'express';
import orderRoutes from './routes/orders';
import { getDatabaseConfig } from './config/database';

const app = express();
app.use(express.json());

const dbConfig = getDatabaseConfig();
console.log('Connecting to database:', dbConfig.url);

app.use('/api', orderRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Dynamic plugin loader — intentionally unresolved call
const loadPlugins = async () => {
  const pluginDir = process.env.PLUGIN_DIR || './plugins';
  return require(pluginDir);
};

loadPlugins().catch(() => {});

export default app;
