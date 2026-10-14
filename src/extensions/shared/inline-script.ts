// Running an inline <script> that a USER_SCRIPT world inserted. Serialized
// with toString into the MAIN-world relay and the session preload, so it must
// stay self-contained.

/** Marks the same-origin child frame a relayed script was inserted into. */
export const RELAY_FRAME_ATTR = 'data-obsidian-bridge-relay';

/**
 * MAIN world: run `detail` ({code, frame} as JSON) in the frame it was
 * inserted into when reachable from here; frames in closed shadow roots are
 * not, so their scripts run in this (same-origin) page.
 */
export function runInlineScript(detail: unknown): boolean {
  const frameAttr = 'data-obsidian-bridge-relay';
  let message: { code?: unknown; frame?: unknown };
  try { message = JSON.parse(String(detail)) as typeof message; } catch { return false; }
  if (typeof message?.code !== 'string') return false;
  const findFrame = (win: Window, token: string, depth: number): Document | null => {
    for (let i = 0; i < win.frames.length; i++) {
      try {
        const doc = win.frames[i].document;
        if (doc?.documentElement?.getAttribute(frameAttr) === token) return doc;
        const nested = depth < 4 ? findFrame(win.frames[i], token, depth + 1) : null;
        if (nested) return nested;
      } catch { /* best effort */ }
    }
    return null;
  };
  const doc = (typeof message.frame === 'string' && findFrame(window, message.frame, 0)) || document;
  const script = doc.createElement('script');
  script.textContent = message.code;
  (doc.head || doc.documentElement).appendChild(script);
  script.remove();
  return true;
}
