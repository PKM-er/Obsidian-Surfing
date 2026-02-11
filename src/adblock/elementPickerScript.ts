export function getElementPickerScript(): string {
	return `
	(function() {
		if (window.__surfingPickerActive) return;
		window.__surfingPickerActive = true;

		const overlay = document.createElement('div');
		overlay.id = '__surfing-picker-overlay';
		overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;cursor:crosshair;';
		document.body.appendChild(overlay);

		const highlight = document.createElement('div');
		highlight.id = '__surfing-picker-highlight';
		highlight.style.cssText = 'position:absolute;border:2px solid red;background:rgba(255,0,0,0.15);pointer-events:none;z-index:2147483647;display:none;';
		document.body.appendChild(highlight);

		const info = document.createElement('div');
		info.id = '__surfing-picker-info';
		info.style.cssText = 'position:fixed;bottom:10px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:4px;z-index:2147483647;font-size:13px;max-width:80%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		info.textContent = 'Click an element to block it. Press Escape to cancel.';
		document.body.appendChild(info);

		let currentEl = null;

		function generateSelector(el) {
			if (el.id) return '#' + CSS.escape(el.id);

			if (el.classList.length > 0) {
				const selector = el.tagName.toLowerCase() + '.' +
					Array.from(el.classList).map(function(c) { return CSS.escape(c); }).join('.');
				if (document.querySelectorAll(selector).length === 1) return selector;
			}

			const path = [];
			let current = el;
			while (current && current !== document.body) {
				let seg = current.tagName.toLowerCase();
				if (current.id) {
					path.unshift('#' + CSS.escape(current.id));
					break;
				}
				const parent = current.parentElement;
				if (parent) {
					const siblings = Array.from(parent.children).filter(
						function(c) { return c.tagName === current.tagName; }
					);
					if (siblings.length > 1) {
						const idx = siblings.indexOf(current) + 1;
						seg += ':nth-of-type(' + idx + ')';
					}
				}
				path.unshift(seg);
				current = parent;
			}
			return path.join(' > ');
		}

		overlay.addEventListener('mousemove', function(e) {
			overlay.style.pointerEvents = 'none';
			const el = document.elementFromPoint(e.clientX, e.clientY);
			overlay.style.pointerEvents = 'auto';
			if (!el || el === overlay || el === highlight || el === info) return;
			currentEl = el;
			const rect = el.getBoundingClientRect();
			highlight.style.display = 'block';
			highlight.style.top = (rect.top + window.scrollY) + 'px';
			highlight.style.left = (rect.left + window.scrollX) + 'px';
			highlight.style.width = rect.width + 'px';
			highlight.style.height = rect.height + 'px';
			info.textContent = generateSelector(el);
		});

		overlay.addEventListener('click', function(e) {
			e.preventDefault();
			e.stopPropagation();
			if (!currentEl) return;
			const selector = generateSelector(currentEl);
			cleanup();
			window.myPostPort?.postMessage('element-picked ' + selector);
		});

		function onKeyDown(e) {
			if (e.key === 'Escape') {
				cleanup();
			}
		}
		document.addEventListener('keydown', onKeyDown, true);

		function cleanup() {
			window.__surfingPickerActive = false;
			overlay.remove();
			highlight.remove();
			info.remove();
			document.removeEventListener('keydown', onKeyDown, true);
		}
	})();
	`;
}

export function getElementPickerScriptWithPromise(): string {
	return `
	new Promise(function(resolve) {
		if (window.__surfingPickerActive) { resolve(null); return; }
		window.__surfingPickerActive = true;

		const overlay = document.createElement('div');
		overlay.id = '__surfing-picker-overlay';
		overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;cursor:crosshair;';
		document.body.appendChild(overlay);

		const highlight = document.createElement('div');
		highlight.id = '__surfing-picker-highlight';
		highlight.style.cssText = 'position:absolute;border:2px solid red;background:rgba(255,0,0,0.15);pointer-events:none;z-index:2147483647;display:none;';
		document.body.appendChild(highlight);

		const info = document.createElement('div');
		info.id = '__surfing-picker-info';
		info.style.cssText = 'position:fixed;bottom:10px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:4px;z-index:2147483647;font-size:13px;max-width:80%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		info.textContent = 'Click an element to block it. Press Escape to cancel.';
		document.body.appendChild(info);

		let currentEl = null;

		function generateSelector(el) {
			if (el.id) return '#' + CSS.escape(el.id);
			if (el.classList.length > 0) {
				const selector = el.tagName.toLowerCase() + '.' +
					Array.from(el.classList).map(function(c) { return CSS.escape(c); }).join('.');
				if (document.querySelectorAll(selector).length === 1) return selector;
			}
			const path = [];
			let current = el;
			while (current && current !== document.body) {
				let seg = current.tagName.toLowerCase();
				if (current.id) { path.unshift('#' + CSS.escape(current.id)); break; }
				const parent = current.parentElement;
				if (parent) {
					const siblings = Array.from(parent.children).filter(
						function(c) { return c.tagName === current.tagName; }
					);
					if (siblings.length > 1) {
						const idx = siblings.indexOf(current) + 1;
						seg += ':nth-of-type(' + idx + ')';
					}
				}
				path.unshift(seg);
				current = parent;
			}
			return path.join(' > ');
		}

		overlay.addEventListener('mousemove', function(e) {
			overlay.style.pointerEvents = 'none';
			const el = document.elementFromPoint(e.clientX, e.clientY);
			overlay.style.pointerEvents = 'auto';
			if (!el || el === overlay || el === highlight || el === info) return;
			currentEl = el;
			const rect = el.getBoundingClientRect();
			highlight.style.display = 'block';
			highlight.style.top = (rect.top + window.scrollY) + 'px';
			highlight.style.left = (rect.left + window.scrollX) + 'px';
			highlight.style.width = rect.width + 'px';
			highlight.style.height = rect.height + 'px';
			info.textContent = generateSelector(el);
		});

		overlay.addEventListener('click', function(e) {
			e.preventDefault();
			e.stopPropagation();
			if (!currentEl) { cleanup(); resolve(null); return; }
			const selector = generateSelector(currentEl);
			cleanup();
			resolve(selector);
		});

		function onKeyDown(e) {
			if (e.key === 'Escape') { cleanup(); resolve(null); }
		}
		document.addEventListener('keydown', onKeyDown, true);

		function cleanup() {
			window.__surfingPickerActive = false;
			overlay.remove();
			highlight.remove();
			info.remove();
			document.removeEventListener('keydown', onKeyDown, true);
		}
	});
	`;
}
