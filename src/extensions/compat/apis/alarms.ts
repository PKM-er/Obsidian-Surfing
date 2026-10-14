// chrome.alarms may be missing in Electron, yet MV3 workers commonly call
// alarms.get/create at top level. Alarm definitions live in storage.local
// (when declared) so every extension context sees the same set and a
// restarted worker restores them; only the service worker runs timers and
// dispatches onAlarm. A stopped worker is NOT woken by them.
import type { InstallContext } from '../context';
import { define, emit, event, invoke, isWorker, missingEvent, missingFn, settle } from '../runtime';
import { callbackOf, eventOf, fields, nsOf } from '../chrome';

interface Alarm { name: string; scheduledTime: number; periodInMinutes?: number }
type AlarmTable = Record<string, Alarm>;

export function installAlarms({ c, chrome, granted, info, report }: InstallContext): void {
  if (!granted.has('alarms') || !missingFn(c.alarms, 'create')) return;
  report('alarms.worker-timers', () => {
    const existing = nsOf(c, 'alarms') ?? {};
    const onAlarm = eventOf(existing, 'onAlarm') ?? event();
    const KEY = '__obsidian_bridge_alarms_v1__';
    const MAX_TIMER = 0x7fffffff;
    const storage = nsOf(c, 'storage');
    const local = nsOf(storage, 'local');
    const persistent = granted.has('storage') && !missingFn(local, 'get');
    let memory: AlarmTable = {};
    const load = async (): Promise<AlarmTable> => persistent
      ? { ...fields(fields(await invoke(chrome, local, 'get', KEY))[KEY]) as AlarmTable }
      : { ...memory };
    const timers = new Map<string, { scheduledTime: number; timer: ReturnType<typeof setTimeout> }>();
    const arm = (alarm: Alarm) => {
      const current = timers.get(alarm.name);
      if (current?.scheduledTime === alarm.scheduledTime) return;
      if (current) clearTimeout(current.timer);
      const wait = Math.max(0, Math.min(alarm.scheduledTime - Date.now(), MAX_TIMER));
      timers.set(alarm.name, { scheduledTime: alarm.scheduledTime, timer: setTimeout(() => fire(alarm.name, alarm.scheduledTime), wait) });
    };
    const reconcile = (all: AlarmTable) => {
      if (!isWorker) return;
      for (const [name, t] of timers) if (!all[name]) { clearTimeout(t.timer); timers.delete(name); }
      for (const alarm of Object.values(all)) arm(alarm);
    };
    // Serialize read-modify-write so concurrent create/clear calls compose.
    let queue: Promise<unknown> = Promise.resolve();
    const mutate = <T>(fn: (all: AlarmTable) => T): Promise<T> => {
      const op = queue.then(async () => {
        const all = await load();
        const result = fn(all);
        if (persistent) await invoke(chrome, local, 'set', { [KEY]: all });
        else memory = all;
        reconcile(all);
        return result;
      });
      queue = op.then(() => undefined, () => undefined);
      return op;
    };
    const fire = (name: string, scheduledTime: number) => {
      timers.delete(name);
      mutate(all => {
        const alarm = all[name];
        // Replaced, cleared, or a long delay split across timers: re-armed by reconcile.
        if (!alarm || alarm.scheduledTime !== scheduledTime || Date.now() < scheduledTime) return null;
        if (alarm.periodInMinutes) {
          const period = alarm.periodInMinutes * 60000;
          let next = alarm.scheduledTime + period;
          if (next <= Date.now()) next = Date.now() + period;
          all[name] = { ...alarm, scheduledTime: next };
        } else delete all[name];
        return { ...alarm };
      }).then(fired => { if (fired) emit(onAlarm, fired); }, e => console.warn('[Chrome Bridge] alarms:', e));
    };
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    // name and callback are optional in front of / after the details object.
    const nameAndCallback = (name: unknown, callback: unknown): [string, unknown] =>
      callbackOf(name) ? ['', name] : [typeof name === 'string' ? name : '', callback];
    const api = {
      create(nameArg?: unknown, infoArg?: unknown, callbackArg?: unknown) {
        let name = '', alarmInfo = infoArg, callback = callbackArg;
        if (typeof nameArg === 'string') name = nameArg;
        else { callback = infoArg; alarmInfo = nameArg; }
        if (callbackOf(alarmInfo)) { callback = alarmInfo; alarmInfo = {}; }
        const { when, delayInMinutes, periodInMinutes } = fields(alarmInfo);
        if (!finite(when) && !finite(delayInMinutes) && !finite(periodInMinutes)) {
          return settle(Promise.reject(new Error('Must set at least one of when, delayInMinutes, or periodInMinutes')), callback);
        }
        const delay = finite(delayInMinutes) ? delayInMinutes : finite(periodInMinutes) ? periodInMinutes : 0;
        const scheduledTime = finite(when) ? when : Date.now() + delay * 60000;
        const alarm: Alarm = { name, scheduledTime, ...(finite(periodInMinutes) ? { periodInMinutes } : {}) };
        return settle(mutate(all => { all[name] = alarm; }).then(() => undefined), callback);
      },
      get(nameArg?: unknown, callbackArg?: unknown) {
        const [key, callback] = nameAndCallback(nameArg, callbackArg);
        return settle(queue.then(load).then(all => all[key] ? { ...all[key] } : undefined), callback);
      },
      getAll(callback?: unknown) {
        return settle(queue.then(load).then(all => Object.values(all)), callback);
      },
      clear(nameArg?: unknown, callbackArg?: unknown) {
        const [key, callback] = nameAndCallback(nameArg, callbackArg);
        return settle(mutate(all => { const had = Object.hasOwn(all, key); delete all[key]; return had; }), callback);
      },
      clearAll(callback?: unknown) {
        return settle(mutate(all => { const had = Object.keys(all).length > 0; for (const k of Object.keys(all)) delete all[k]; return had; }), callback);
      }
    };
    for (const [key, value] of Object.entries(api)) if (missingFn(existing, key)) define(existing, key, value);
    if (missingEvent(existing, 'onAlarm')) define(existing, 'onAlarm', onAlarm);
    if (!c.alarms) define(c, 'alarms', existing);
    if (isWorker) {
      mutate(() => undefined).catch(e => console.warn('[Chrome Bridge] alarms restore:', e));
      const onChanged = eventOf(storage, 'onChanged');
      if (persistent && onChanged) onChanged.addListener((changes: unknown, areaName: unknown) => {
        const change = fields(changes)[KEY];
        if (areaName === 'local' && change) reconcile(fields(fields(change).newValue) as AlarmTable);
      });
    }
    info.modes.alarms = 'timers in the service worker; a stopped worker is not woken' +
      (persistent ? '' : '; not persisted (no storage permission)');
  });
}
