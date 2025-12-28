import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Paper, PaperFile, Highlight, Note, Riff, FurtherReading, AppSettings, HighlightColor } from '../types';

interface PaperTrackingDB extends DBSchema {
  papers: {
    key: string;
    value: Paper;
    indexes: { 'by-title': string; 'by-uploaded': Date };
  };
  paperFiles: {
    key: string;
    value: PaperFile;
    indexes: { 'by-paper': string };
  };
  highlights: {
    key: string;
    value: Highlight;
    indexes: { 'by-paper': string; 'by-further-reading': number };
  };
  notes: {
    key: string;
    value: Note;
    indexes: { 'by-highlight': string; 'by-paper': string };
  };
  riffs: {
    key: string;
    value: Riff;
    indexes: { 'by-paper': string };
  };
  furtherReading: {
    key: string;
    value: FurtherReading;
    indexes: { 'by-paper': string; 'by-resolved': number };
  };
  settings: {
    key: string;
    value: AppSettings;
  };
}

let dbInstance: IDBPDatabase<PaperTrackingDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<PaperTrackingDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<PaperTrackingDB>('paper-tracking-db', 1, {
    upgrade(db) {
      // Papers store
      const paperStore = db.createObjectStore('papers', { keyPath: 'id' });
      paperStore.createIndex('by-title', 'title');
      paperStore.createIndex('by-uploaded', 'uploadedAt');

      // Paper files store (for actual PDF data)
      const fileStore = db.createObjectStore('paperFiles', { keyPath: 'id' });
      fileStore.createIndex('by-paper', 'paperId');

      // Highlights store
      const highlightStore = db.createObjectStore('highlights', { keyPath: 'id' });
      highlightStore.createIndex('by-paper', 'paperId');
      highlightStore.createIndex('by-further-reading', 'isFurtherReading');

      // Notes store
      const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
      noteStore.createIndex('by-highlight', 'highlightId');
      noteStore.createIndex('by-paper', 'paperId');

      // Riffs store
      const riffStore = db.createObjectStore('riffs', { keyPath: 'id' });
      riffStore.createIndex('by-paper', 'paperId');

      // Further reading store
      const furtherReadingStore = db.createObjectStore('furtherReading', { keyPath: 'id' });
      furtherReadingStore.createIndex('by-paper', 'paperId');
      furtherReadingStore.createIndex('by-resolved', 'resolved');

      // Settings store
      db.createObjectStore('settings', { keyPath: 'id' });
    },
  });

  return dbInstance;
}

// Paper operations
export async function getAllPapers(): Promise<Paper[]> {
  const db = await getDB();
  return db.getAll('papers');
}

export async function getPaper(id: string): Promise<Paper | undefined> {
  const db = await getDB();
  return db.get('papers', id);
}

export async function addPaper(paper: Paper): Promise<void> {
  const db = await getDB();
  await db.put('papers', paper);
}

export async function updatePaper(paper: Paper): Promise<void> {
  const db = await getDB();
  await db.put('papers', paper);
}

export async function deletePaper(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['papers', 'paperFiles', 'highlights', 'notes', 'riffs', 'furtherReading'], 'readwrite');
  
  // Delete paper
  await tx.objectStore('papers').delete(id);
  
  // Delete paper file
  const files = await tx.objectStore('paperFiles').index('by-paper').getAll(id);
  for (const file of files) {
    await tx.objectStore('paperFiles').delete(file.id);
  }
  
  // Delete highlights
  const highlights = await tx.objectStore('highlights').index('by-paper').getAll(id);
  for (const highlight of highlights) {
    await tx.objectStore('highlights').delete(highlight.id);
  }
  
  // Delete notes
  const notes = await tx.objectStore('notes').index('by-paper').getAll(id);
  for (const note of notes) {
    await tx.objectStore('notes').delete(note.id);
  }
  
  // Delete riffs
  const riffs = await tx.objectStore('riffs').index('by-paper').getAll(id);
  for (const riff of riffs) {
    await tx.objectStore('riffs').delete(riff.id);
  }
  
  // Delete further reading
  const furtherReading = await tx.objectStore('furtherReading').index('by-paper').getAll(id);
  for (const fr of furtherReading) {
    await tx.objectStore('furtherReading').delete(fr.id);
  }
  
  await tx.done;
}

// Paper file operations
export async function getPaperFile(paperId: string): Promise<PaperFile | undefined> {
  const db = await getDB();
  const files = await db.getAllFromIndex('paperFiles', 'by-paper', paperId);
  return files[0];
}

export async function addPaperFile(file: PaperFile): Promise<void> {
  const db = await getDB();
  await db.put('paperFiles', file);
}

// Highlight operations
export async function getHighlightsByPaper(paperId: string): Promise<Highlight[]> {
  const db = await getDB();
  return db.getAllFromIndex('highlights', 'by-paper', paperId);
}

export async function addHighlight(highlight: Highlight): Promise<void> {
  const db = await getDB();
  await db.put('highlights', highlight);
}

export async function updateHighlight(highlight: Highlight): Promise<void> {
  const db = await getDB();
  await db.put('highlights', highlight);
}

export async function deleteHighlight(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('highlights', id);
}

export async function getAllFurtherReadingHighlights(): Promise<Highlight[]> {
  const db = await getDB();
  const allHighlights = await db.getAll('highlights');
  return allHighlights.filter(h => h.isFurtherReading);
}

// Note operations
export async function getAllNotes(): Promise<Note[]> {
  const db = await getDB();
  return db.getAll('notes');
}

export async function getNotesByHighlight(highlightId: string): Promise<Note[]> {
  const db = await getDB();
  return db.getAllFromIndex('notes', 'by-highlight', highlightId);
}

export async function getNotesByPaper(paperId: string): Promise<Note[]> {
  const db = await getDB();
  return db.getAllFromIndex('notes', 'by-paper', paperId);
}

export async function addNote(note: Note): Promise<void> {
  const db = await getDB();
  await db.put('notes', note);
}

export async function updateNote(note: Note): Promise<void> {
  const db = await getDB();
  await db.put('notes', note);
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('notes', id);
}

// Riff operations
export async function getRiffsByPaper(paperId: string): Promise<Riff[]> {
  const db = await getDB();
  return db.getAllFromIndex('riffs', 'by-paper', paperId);
}

export async function addRiff(riff: Riff): Promise<void> {
  const db = await getDB();
  await db.put('riffs', riff);
}

export async function deleteRiff(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('riffs', id);
}

// Further reading operations
export async function getFurtherReadingByPaper(paperId: string): Promise<FurtherReading[]> {
  const db = await getDB();
  return db.getAllFromIndex('furtherReading', 'by-paper', paperId);
}

export async function getAllFurtherReading(): Promise<FurtherReading[]> {
  const db = await getDB();
  return db.getAll('furtherReading');
}

export async function addFurtherReading(item: FurtherReading): Promise<void> {
  const db = await getDB();
  await db.put('furtherReading', item);
}

export async function updateFurtherReading(item: FurtherReading): Promise<void> {
  const db = await getDB();
  await db.put('furtherReading', item);
}

export async function deleteFurtherReading(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('furtherReading', id);
}

// Settings operations
export async function getSettings(): Promise<AppSettings> {
  const db = await getDB();
  const settings = await db.get('settings', 'app-settings');
  return settings || {
    defaultHighlightColor: 'yellow' as HighlightColor,
    sidebarWidth: 320,
  };
}

export async function updateSettings(settings: AppSettings): Promise<void> {
  const db = await getDB();
  await db.put('settings', { ...settings, id: 'app-settings' } as AppSettings & { id: string });
}

// Get all unique tags
export async function getAllTags(): Promise<string[]> {
  const papers = await getAllPapers();
  const tagSet = new Set<string>();
  papers.forEach(paper => {
    paper.tags.forEach(tag => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}

