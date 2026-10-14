const DB_NAME = "surfing-ai";
const STORE_NAME = "chat-history";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: "id" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
	});
}

export async function loadChatHistoryFromDB<
	T extends { id: string; timestamp: number },
>(): Promise<T[]> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const request = store.getAll();
		request.onsuccess = () => {
			const entries = (request.result as T[]).sort(
				(a, b) => a.timestamp - b.timestamp,
			);
			resolve(entries);
		};
		request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
		tx.oncomplete = () => db.close();
	});
}

export async function saveChatHistoryToDB<T extends { id: string }>(
	entries: T[],
): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.clear();
		for (const entry of entries) {
			store.put(entry);
		}
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error ?? new Error("IndexedDB transaction failed"));
		};
	});
}

export async function clearChatHistoryDB(): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.clear();
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error ?? new Error("IndexedDB transaction failed"));
		};
	});
}
