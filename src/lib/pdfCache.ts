/**
 * PDF Cache using IndexedDB
 * Provides local caching for PDF files to improve load times and network resilience
 */

const DB_NAME = 'paper-tracking-pdf-cache';
const DB_VERSION = 1;
const STORE_NAME = 'pdfs';

interface CachedPdf {
    paperId: string;
    data: ArrayBuffer;
    cachedAt: number;
}

/**
 * Opens the IndexedDB database for PDF caching
 */
function openPdfCacheDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.warn('[PdfCache] Failed to open IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'paperId' });
                console.log('[PdfCache] Created IndexedDB store for PDF caching');
            }
        };
    });
}

/**
 * Retrieves a cached PDF by paper ID
 */
export async function getCachedPdf(paperId: string): Promise<ArrayBuffer | undefined> {
    try {
        const db = await openPdfCacheDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(paperId);

            request.onerror = () => {
                console.warn('[PdfCache] Error reading from cache:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                const result = request.result as CachedPdf | undefined;
                if (result) {
                    console.log(`[PdfCache] Cache HIT for paper ${paperId}, cached at ${new Date(result.cachedAt).toLocaleString()}`);
                    resolve(result.data);
                } else {
                    console.log(`[PdfCache] Cache MISS for paper ${paperId}`);
                    resolve(undefined);
                }
            };

            transaction.oncomplete = () => {
                db.close();
            };
        });
    } catch (error) {
        console.warn('[PdfCache] Cache read failed, will download from server:', error);
        return undefined;
    }
}

/**
 * Stores a PDF in the cache
 */
export async function cachePdf(paperId: string, data: ArrayBuffer): Promise<void> {
    try {
        const db = await openPdfCacheDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            const cachedPdf: CachedPdf = {
                paperId,
                data,
                cachedAt: Date.now(),
            };

            const request = store.put(cachedPdf);

            request.onerror = () => {
                console.warn('[PdfCache] Error writing to cache:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                console.log(`[PdfCache] Cached PDF for paper ${paperId} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
                resolve();
            };

            transaction.oncomplete = () => {
                db.close();
            };
        });
    } catch (error) {
        console.warn('[PdfCache] Cache write failed:', error);
        // Don't throw - caching failure shouldn't break the app
    }
}

/**
 * Deletes a cached PDF
 */
export async function deleteCachedPdf(paperId: string): Promise<void> {
    try {
        const db = await openPdfCacheDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(paperId);

            request.onerror = () => {
                console.warn('[PdfCache] Error deleting from cache:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                console.log(`[PdfCache] Deleted cached PDF for paper ${paperId}`);
                resolve();
            };

            transaction.oncomplete = () => {
                db.close();
            };
        });
    } catch (error) {
        console.warn('[PdfCache] Cache delete failed:', error);
        // Don't throw - cache cleanup failure shouldn't break the app
    }
}

/**
 * Clears all cached PDFs
 */
export async function clearPdfCache(): Promise<void> {
    try {
        const db = await openPdfCacheDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onerror = () => {
                console.warn('[PdfCache] Error clearing cache:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                console.log('[PdfCache] Cleared all cached PDFs');
                resolve();
            };

            transaction.oncomplete = () => {
                db.close();
            };
        });
    } catch (error) {
        console.warn('[PdfCache] Cache clear failed:', error);
    }
}
