// Script of the hidden bridge page (__obsidian_bridge_host.html) that Chrome
// Bridge keeps open per extension. It relays between the Obsidian host
// (executeJavaScript in, console output out) and the extension's own contexts
// (BroadcastChannel). It holds no state and runs no extension code.
import { CHANNEL_NAME, CONSOLE_PREFIX, Envelope, ExtensionToHost, HostToExtension } from '../shared/protocol';

const channel = new BroadcastChannel(CHANNEL_NAME);
const toHost = (message: ExtensionToHost) => console.debug(CONSOLE_PREFIX + JSON.stringify(message));

channel.addEventListener('message', event => {
  const data = event.data as Envelope;
  if (!data || data.v !== 1 || data.from !== 'extension' || typeof data.type !== 'string') return;
  const { v: _v, from: _from, ...message } = data;
  toHost(message);
});

Object.defineProperty(globalThis, '__obsidianBridgeHost', {
  configurable: false,
  value: Object.freeze({
    send(message: HostToExtension): boolean {
      if (!message || typeof message.type !== 'string') return false;
      channel.postMessage({ v: 1, from: 'host', ...message });
      return true;
    }
  })
});

toHost({ type: 'bridge.ready' });
