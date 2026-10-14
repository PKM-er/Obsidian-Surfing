// Privileged runtime diagnostics for managed extension service workers.
// Subscribes before extensions load so errors during initial evaluation are
// kept. Never injects code and never observes unrelated web pages.

import { text } from '../shared/text';
import { tr } from '../i18n/strings';
import type * as Electron from 'electron';

export interface RuntimeEvent {
  time: string;
  kind: string;
  url?: string;
  scope?: string;
  message?: string;
  level?: unknown;
  line?: number;
  versionId?: number;
  state?: string;
}

const COMPAT_REPORT = '[Chrome Bridge Compat] ';

export class CompatRuntime {
  events: RuntimeEvent[] = [];
  private subscriptions: Array<() => void> = [];

  constructor(private session: Electron.Session, private allowedIds: () => string[] = () => []) {
    const sw = session.serviceWorkers;
    this.subscribe(sw, 'registration-completed', (_event: Electron.Event, data: Electron.RegistrationCompletedDetails) => {
      if (this.isAllowed(data?.scope)) this.record('registered', { scope: data.scope });
    });
    // Electron 43 puts the fields on the event itself; older versions passed
    // them as a second argument.
    this.subscribe(sw, 'running-status-changed', (event: Electron.Event<Electron.ServiceWorkersRunningStatusChangedEventParams>, legacy?: Electron.ServiceWorkersRunningStatusChangedEventParams) => {
      const data = legacy ?? event;
      // This event only contains a versionId, so it may be impossible to
      // attribute stopped workers. Never misattribute it to an extension.
      let scope: string | null = null;
      try { scope = sw.getInfoFromVersionID(data.versionId)?.scope || null; } catch { /* best effort */ }
      if (scope && this.isAllowed(scope)) this.record('status', { scope, versionId: data.versionId, state: data.runningStatus });
    });
    this.subscribe(sw, 'console-message', (_event: Electron.Event, data: Electron.MessageDetails) => {
      if (!this.isAllowed(data?.sourceUrl)) return;
      const message = text(data.message);
      this.record('console', {
        url: data.sourceUrl,
        // The compat report is one JSON line; truncating it would make it unparsable.
        message: message.slice(0, message.startsWith(COMPAT_REPORT) ? 8000 : 1500),
        level: data.level, line: data.lineNumber, versionId: data.versionId
      });
    });
  }

  isAllowed(value: unknown): boolean {
    const m = text(value).match(/^chrome-extension:\/\/([a-p]{32})(?:\/|$)/);
    return !!m && this.allowedIds().includes(m[1]);
  }

  record(kind: string, detail: Omit<RuntimeEvent, 'time' | 'kind'>): void {
    this.events.push({ time: new Date().toISOString(), kind, ...detail });
    if (this.events.length > 120) this.events.splice(0, this.events.length - 120);
  }

  private subscribe<F extends (...args: never[]) => void>(emitter: Electron.ServiceWorkers, event: string, callback: F): void {
    // Electron's overloads are per event name; the listener types above match them.
    const target = emitter as unknown as { on?: (event: string, fn: F) => void; removeListener?: (event: string, fn: F) => void };
    if (typeof target?.on !== 'function') return;
    target.on(event, callback);
    this.subscriptions.push(() => {
      try { target.removeListener?.(event, callback); } catch { /* best effort */ }
    });
  }

  snapshot(id: string | null = null): { workers: Electron.ServiceWorkerInfo[]; events: RuntimeEvent[] } {
    const all = Object.values(this.session.serviceWorkers.getAllRunning());
    const workers = all.filter(x => this.isAllowed(x.scope) && (!id || x.scope.startsWith(`chrome-extension://${id}/`)));
    return {
      workers,
      events: this.events.filter(x => !id || (x.url || x.scope || '').startsWith(`chrome-extension://${id}/`)).slice(-40)
    };
  }

  /** The compat layer's own report from the latest worker run, if seen. */
  latestCompatReport(id: string): unknown {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.kind === 'console' && (e.url ?? '').startsWith(`chrome-extension://${id}/`) && e.message?.startsWith(COMPAT_REPORT)) {
        try { return JSON.parse(e.message.slice(COMPAT_REPORT.length)) as unknown; } catch { return null; }
      }
    }
    return null;
  }

  async start(id: string): Promise<{ scope: string; started: boolean; workers: Electron.ServiceWorkerInfo[]; events: RuntimeEvent[] }> {
    if (!/^[a-p]{32}$/.test(id)) throw new Error(tr('error.invalidExtensionId'));
    if (!this.allowedIds().includes(id)) throw new Error(tr('error.notManaged'));
    if (!this.session.extensions.getExtension(id)) throw new Error(tr('error.notLoadedInSession'));
    const scope = `chrome-extension://${id}/`;
    if (typeof this.session.serviceWorkers.startWorkerForScope !== 'function') {
      throw new Error(tr('error.noStartWorker'));
    }
    const worker = await this.session.serviceWorkers.startWorkerForScope(scope);
    this.record('start-requested', { scope });
    return { scope, started: !!worker, ...this.snapshot(id) };
  }

  close(): void { for (const off of this.subscriptions.splice(0)) off(); }
}
