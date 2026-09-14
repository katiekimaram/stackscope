import { createService } from './app.mjs';
const service = createService();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);
service.server.listen(port,host,() => console.log('StackScope service listening on ' + host + ':' + port));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => { service.close().then(() => process.exit(0)); });
