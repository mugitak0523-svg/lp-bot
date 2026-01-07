import 'dotenv/config';

import { startApiServer } from './api/server';
import { startMonitor } from './bot/monitor';
import { setSnapshot } from './state/store';

const port = Number(process.env.PORT ?? '3000');

startApiServer(port);
startMonitor({
  onSnapshot: (snapshot) => {
    setSnapshot(snapshot);
  },
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
