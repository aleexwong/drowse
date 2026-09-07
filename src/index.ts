import { loadConfig } from './config.ts';
import { createApp } from './http.ts';
import { createStore } from './store/index.ts';

const config = loadConfig();
const store = createStore(config);
const app = createApp(store, config);

const server = app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      event: 'server.listening',
      port: config.port,
      store: config.store,
      timezone: config.timezone,
      defaultPhase: config.defaultPhase,
    }),
  );
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void store.close().finally(() => process.exit(0));
    });
  });
}
