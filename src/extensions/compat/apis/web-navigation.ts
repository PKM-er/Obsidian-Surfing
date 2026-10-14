// chrome.webNavigation is not in Electron's extension API subset. Missing
// events are filled for extensions that declared the permission; the host
// observes Obsidian Web Viewer navigations and delivers them through the
// bridge. Listener URL filters ({url: UrlFilter[]}) are honored here.
import type { InstallContext } from '../context';
import { define, emit, event, invoke, isWorker, listenerCount, missingFn, settle } from '../runtime';
import { eventFilterMatches } from '../../shared/url-match';
import { FrameDetails, WEB_NAVIGATION_EVENTS, WebNavigationEvent } from '../../shared/protocol';
import { eventOf, fields, fnOf, nsOf } from '../chrome';

const FRAME_TIMEOUT_MS = 1500;

export function installWebNavigation(ctx: InstallContext): void {
  const { c, chrome, granted, info, shared, report } = ctx;
  if (!granted.has('webNavigation')) return;
  const missing = WEB_NAVIGATION_EVENTS.filter(name => !eventOf(c.webNavigation, name));
  if (missing.length) report('webNavigation.events', () => {
    const existing = nsOf(c, 'webNavigation') ?? {};
    // Tell the host which events have listeners so it only wakes this
    // worker for navigations someone is waiting for (as Chrome does).
    let pending = false;
    const announce = () => {
      if (!isWorker || pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        const events = WEB_NAVIGATION_EVENTS.filter(name => listenerCount(existing[name]) > 0);
        shared.bridge.post({ type: 'webNavigation.listeners', events });
      }, 0);
    };
    for (const name of missing) {
      define(existing, name, event({
        // onCreatedNavigationTarget/onTabReplaced details carry `url` or none.
        accepts: (filter, args) => eventFilterMatches(filter, fields(args[0]).url),
        onChange: announce
      }));
    }
    if (!c.webNavigation) define(c, 'webNavigation', existing);
    shared.navigation.add(existing);
    shared.bridge.on('bridge.sync', announce);
    if (isWorker) announce();
    info.modes.webNavigation = shared.bridge.available
      ? 'events delivered from Obsidian Web Viewer tabs (transitionType is approximate)'
      : 'registration-only: BroadcastChannel unavailable, events are not delivered';
  });

  // Frame queries are answered by the host (it can enumerate a tab's frames);
  // if it does not answer in time, fall back to the main frame from tabs.get.
  const webNavigation = nsOf(c, 'webNavigation');
  if (webNavigation && (missingFn(webNavigation, 'getAllFrames') || missingFn(webNavigation, 'getFrame'))) {
    report('webNavigation.frames', () => {
      // undefined = host unreachable (fall back); null = not a known tab.
      const fromHost = (tabId: number): Promise<FrameDetails[] | null | undefined> =>
        shared.bridge.request('webNavigation.getAllFrames', { tabId }, FRAME_TIMEOUT_MS)
          .then(frames => Array.isArray(frames) ? frames : null, () => undefined);
      const mainFrameOnly = async (tabId: number): Promise<FrameDetails[] | null> => {
        const tabs = nsOf(c, 'tabs');
        if (!fnOf(tabs, 'get')) return null;
        let tab: unknown;
        try { tab = await invoke(chrome, tabs, 'get', tabId); } catch { return null; }
        if (!tab) return null;
        const url = fields(tab).url;
        return [{ frameId: 0, parentFrameId: -1, processId: -1, url: typeof url === 'string' ? url : '', errorOccurred: false,
          documentLifecycle: 'active', frameType: 'outermost_frame' }];
      };
      // Chrome returns null for an unknown tab rather than an empty list.
      const allFrames = async (tabId: unknown): Promise<FrameDetails[] | null> => {
        if (typeof tabId !== 'number' || !Number.isInteger(tabId)) return null;
        const answered = await fromHost(tabId);
        return answered !== undefined ? answered : mainFrameOnly(tabId);
      };
      if (missingFn(webNavigation, 'getAllFrames')) define(webNavigation, 'getAllFrames',
        (details: unknown, callback?: unknown) => settle(allFrames(fields(details).tabId), callback));
      if (missingFn(webNavigation, 'getFrame')) define(webNavigation, 'getFrame',
        (details: unknown, callback?: unknown) => settle(allFrames(fields(details).tabId).then(frames =>
          frames?.find(f => f.frameId === (fields(details).frameId ?? 0)) ?? null), callback));
      info.modes.webNavigationFrames = 'answered by Obsidian; main frame only when the host is unreachable';
    });
  }
}

/** Host → extension delivery; registered once, emits on every filled root. */
export function deliverWebNavigation(ctx: Pick<InstallContext, 'shared'>): void {
  ctx.shared.bridge.on('webNavigation.event', message => {
    const name: WebNavigationEvent = message.event;
    if (!(WEB_NAVIGATION_EVENTS as readonly string[]).includes(name) || !message.details || typeof message.details !== 'object') return;
    for (const namespace of ctx.shared.navigation) emit(namespace[name], { ...message.details });
  });
}
