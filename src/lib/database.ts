import { supabase } from './supabase';
import type { Paper, PaperFile, Highlight, Note, Riff, FurtherReading, AppSettings, HighlightColor, JournalEntry } from '../types';

// Helper to convert database row to Paper type
function rowToPaper(row: Record<string, unknown>): Paper {
  const metadata = row.metadata as Record<string, unknown> | null;
  
  // Ensure tags is always an array
  let tags: string[] = [];
  if (Array.isArray(row.tags)) {
    tags = row.tags.filter((t): t is string => typeof t === 'string');
  }
  
  // Validate required fields
  if (!row.id || !row.title) {
    console.error('Invalid paper data:', row);
    throw new Error('Paper missing required fields (id or title)');
  }
  
  return {
    id: String(row.id),
    title: String(row.title),
    authors: row.authors ? String(row.authors) : undefined,
    tags: tags,
    uploadedAt: row.created_at ? new Date(String(row.created_at)) : new Date(),
    lastOpenedAt: row.last_opened_at ? new Date(String(row.last_opened_at)) : undefined,
    isRead: Boolean(row.is_read),
    isStarred: Boolean(row.is_starred),
    metadata: row.metadata as Paper['metadata'] || {},
    fileName: (metadata?.fileName as string) || `${row.id}.pdf`,
    fileSize: (metadata?.fileSize as number) || 0,
  };
}

// Helper to convert database row to Highlight type
function rowToHighlight(row: Record<string, unknown>): Highlight {
  const createdAt = new Date(row.created_at as string);
  return {
    id: row.id as string,
    paperId: row.paper_id as string,
    text: row.text as string,
    color: row.color as HighlightColor,
    pageNumber: row.page_number as number,
    rects: row.rects as Highlight['rects'],
    isFurtherReading: row.is_further_reading as boolean,
    createdAt: createdAt,
    updatedAt: createdAt, // Use createdAt as default for updatedAt
  };
}

// Helper to convert database row to Note type
function rowToNote(row: Record<string, unknown>): Note {
  const createdAt = new Date(row.created_at as string);
  return {
    id: row.id as string,
    highlightId: row.highlight_id as string,
    paperId: row.paper_id as string,
    content: row.content as string,
    createdAt: createdAt,
    updatedAt: createdAt, // Use createdAt as default for updatedAt
  };
}

// Paper operations
export async function getAllPapers(): Promise<Paper[]> {
  const { data, error } = await supabase
    .from('papers')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('[Database] Error fetching papers:', error);
    throw error;
  }
  
  if (!data) return [];
  
  // Filter out invalid papers and log errors
  const validPapers: Paper[] = [];
  for (const row of data) {
    try {
      validPapers.push(rowToPaper(row));
    } catch (err) {
      console.error('[Database] Error parsing paper:', row.id, err);
      // Skip corrupted papers instead of crashing
    }
  }
  
  return validPapers;
}

export async function getPaper(id: string): Promise<Paper | undefined> {
  const { data, error } = await supabase
    .from('papers')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return undefined; // Not found
    throw error;
  }
  return data ? rowToPaper(data) : undefined;
}

export async function addPaper(paper: Paper): Promise<void> {
  const { error } = await supabase.from('papers').insert({
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    tags: paper.tags,
    created_at: paper.uploadedAt.toISOString(),
    last_opened_at: paper.lastOpenedAt?.toISOString(),
    is_read: paper.isRead ?? false,
    is_starred: paper.isStarred ?? false,
    metadata: {
      ...paper.metadata,
      fileName: paper.fileName,
      fileSize: paper.fileSize,
    },
  });
  
  if (error) throw error;
}

export async function updatePaper(paper: Paper): Promise<void> {
  // Ensure tags is always an array
  const tags = Array.isArray(paper.tags) ? paper.tags : [];
  
  const { error } = await supabase
    .from('papers')
    .update({
      title: paper.title,
      authors: paper.authors,
      tags: tags, // Ensure it's always an array
      last_opened_at: paper.lastOpenedAt?.toISOString(),
      is_read: paper.isRead ?? false,
      is_starred: paper.isStarred ?? false,
      metadata: paper.metadata || {},
    })
    .eq('id', paper.id);
  
  if (error) {
    console.error('[Database] Error updating paper:', paper.id, error);
    throw error;
  }
}

// Batch update multiple papers at once (much faster than individual updates)
export async function updatePapersBatch(papers: Paper[]): Promise<void> {
  if (papers.length === 0) return;
  
  // Prepare updates - only include fields that can be updated
  const updates = papers.map(paper => {
    const tags = Array.isArray(paper.tags) ? paper.tags : [];
    return {
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      tags: tags,
      last_opened_at: paper.lastOpenedAt?.toISOString(),
      is_read: paper.isRead ?? false,
      is_starred: paper.isStarred ?? false,
      metadata: paper.metadata || {},
    };
  });
  
  // Use upsert to update multiple papers in a single operation
  const { error } = await supabase
    .from('papers')
    .upsert(updates, {
      onConflict: 'id',
      ignoreDuplicates: false,
    });
  
  if (error) {
    console.error('[Database] Error batch updating papers:', error);
    throw error;
  }
}

export async function deletePaper(id: string): Promise<void> {
  // Delete PDF file from storage
  const { error: storageError } = await supabase.storage
    .from('pdfs')
    .remove([`${id}.pdf`]);
  
  if (storageError) console.warn('Error deleting PDF from storage:', storageError);
  
  // Delete paper (cascades to highlights and notes)
  const { error } = await supabase
    .from('papers')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
}

// Paper file operations - using Supabase Storage
export async function getPaperFile(paperId: string): Promise<PaperFile | undefined> {
  console.log(`[Database] Downloading PDF for paper ${paperId}...`);
  const startTime = Date.now();
  
  const { data, error } = await supabase.storage
    .from('pdfs')
    .download(`${paperId}.pdf`);
  
  if (error) {
    console.warn('Error downloading PDF:', error);
    return undefined;
  }
  
  const arrayBuffer = await data.arrayBuffer();
  console.log(`[Database] PDF downloaded in ${Date.now() - startTime}ms, size: ${arrayBuffer.byteLength} bytes`);
  
  if (arrayBuffer.byteLength === 0) {
    console.warn(`[Database] Downloaded PDF is empty for paper ${paperId}`);
    return undefined;
  }
  
  return {
    id: paperId,
    paperId: paperId,
    data: arrayBuffer,
  };
}

// Get public URL for a PDF (faster for viewing)
export function getPaperFileUrl(paperId: string): string {
  const { data } = supabase.storage
    .from('pdfs')
    .getPublicUrl(`${paperId}.pdf`);
  
  return data.publicUrl;
}

export async function addPaperFile(file: PaperFile): Promise<void> {
  // Validate that we have actual file data
  if (!file.data || file.data.byteLength === 0) {
    throw new Error(`Cannot upload empty PDF file for paper ${file.paperId}`);
  }
  
  console.log(`Uploading PDF for paper ${file.paperId}, size: ${file.data.byteLength} bytes`);
  
  const blob = new Blob([file.data], { type: 'application/pdf' });
  
  // Verify blob was created correctly
  if (blob.size === 0) {
    throw new Error(`Blob creation failed - size is 0 for paper ${file.paperId}`);
  }
  
  const { error, data } = await supabase.storage
    .from('pdfs')
    .upload(`${file.paperId}.pdf`, blob, {
      contentType: 'application/pdf',
      upsert: true,
    });
  
  if (error) {
    console.error('Supabase storage upload error:', error);
    throw error;
  }
  
  console.log(`PDF uploaded successfully for paper ${file.paperId}`, data);
}

// Highlight operations
export async function getHighlightsByPaper(paperId: string): Promise<Highlight[]> {
  const { data, error } = await supabase
    .from('highlights')
    .select('*')
    .eq('paper_id', paperId)
    .order('created_at', { ascending: true });
  
  if (error) throw error;
  return (data || []).map(rowToHighlight);
}

export async function addHighlight(highlight: Highlight): Promise<void> {
  const { error } = await supabase.from('highlights').insert({
    id: highlight.id,
    paper_id: highlight.paperId,
    text: highlight.text,
    color: highlight.color,
    page_number: highlight.pageNumber,
    rects: highlight.rects,
    is_further_reading: highlight.isFurtherReading ?? false,
    created_at: highlight.createdAt.toISOString(),
  });
  
  if (error) throw error;
}

export async function updateHighlight(highlight: Highlight): Promise<void> {
  const { error } = await supabase
    .from('highlights')
    .update({
      text: highlight.text,
      color: highlight.color,
      page_number: highlight.pageNumber,
      rects: highlight.rects,
      is_further_reading: highlight.isFurtherReading ?? false,
    })
    .eq('id', highlight.id);
  
  if (error) throw error;
}

export async function deleteHighlight(id: string): Promise<void> {
  const { error } = await supabase
    .from('highlights')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
}

export async function getAllFurtherReadingHighlights(): Promise<Highlight[]> {
  const { data, error } = await supabase
    .from('highlights')
    .select('*')
    .eq('is_further_reading', true)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return (data || []).map(rowToHighlight);
}

// Note operations
export async function getAllNotes(): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return (data || []).map(rowToNote);
}

export async function getNotesByHighlight(highlightId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('highlight_id', highlightId)
    .order('created_at', { ascending: true });
  
  if (error) throw error;
  return (data || []).map(rowToNote);
}

export async function getNotesByPaper(paperId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('paper_id', paperId)
    .order('created_at', { ascending: true });
  
  if (error) throw error;
  return (data || []).map(rowToNote);
}

export async function addNote(note: Note): Promise<void> {
  const { error } = await supabase.from('notes').insert({
    id: note.id,
    highlight_id: note.highlightId,
    paper_id: note.paperId,
    content: note.content,
    created_at: note.createdAt.toISOString(),
  });
  
  if (error) throw error;
}

export async function updateNote(note: Note): Promise<void> {
  const { error } = await supabase
    .from('notes')
    .update({
      content: note.content,
    })
    .eq('id', note.id);
  
  if (error) throw error;
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase
    .from('notes')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
}

// Riff operations (kept for backwards compatibility, but not used)
export async function getRiffsByPaper(_paperId: string): Promise<Riff[]> {
  return [];
}

export async function addRiff(_riff: Riff): Promise<void> {
  // Not implemented - riffs feature was removed
}

export async function deleteRiff(_id: string): Promise<void> {
  // Not implemented - riffs feature was removed
}

// Further reading operations (now using highlights with isFurtherReading flag)
export async function getFurtherReadingByPaper(paperId: string): Promise<FurtherReading[]> {
  const highlights = await getHighlightsByPaper(paperId);
  return highlights
    .filter(h => h.isFurtherReading)
    .map(h => ({
      id: h.id,
      highlightId: h.id,
      paperId: h.paperId,
      title: h.text,
      resolved: false,
      createdAt: h.createdAt,
    }));
}

export async function getAllFurtherReading(): Promise<FurtherReading[]> {
  const highlights = await getAllFurtherReadingHighlights();
  return highlights.map(h => ({
    id: h.id,
    highlightId: h.id,
    paperId: h.paperId,
    title: h.text,
    resolved: false,
    createdAt: h.createdAt,
  }));
}

export async function addFurtherReading(_item: FurtherReading): Promise<void> {
  // Now handled through addHighlight with isFurtherReading flag
}

export async function updateFurtherReading(_item: FurtherReading): Promise<void> {
  // Now handled through updateHighlight
}

export async function deleteFurtherReading(id: string): Promise<void> {
  await deleteHighlight(id);
}

// Journal Entry operations
function rowToJournalEntry(row: Record<string, unknown>): JournalEntry {
  return {
    id: row.id as string,
    date: row.date as string,
    paperIds: (row.paper_ids as string[]) || [],
    synthesis: (row.synthesis as string) || '',
    keyInsights: (row.key_insights as string[]) || [],
    isGenerated: Boolean(row.is_generated),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export async function getAllJournalEntries(): Promise<JournalEntry[]> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .order('date', { ascending: false });
  
  if (error) {
    console.error('[Database] Error fetching journal entries:', error);
    return [];
  }
  
  return (data || []).map(rowToJournalEntry);
}

export async function getJournalEntry(date: string): Promise<JournalEntry | undefined> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('date', date)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return undefined; // Not found
    console.error('[Database] Error fetching journal entry:', error);
    return undefined;
  }
  return data ? rowToJournalEntry(data) : undefined;
}

export async function addJournalEntry(entry: JournalEntry): Promise<void> {
  const { error } = await supabase.from('journal_entries').insert({
    id: entry.id,
    date: entry.date,
    paper_ids: entry.paperIds,
    synthesis: entry.synthesis,
    key_insights: entry.keyInsights,
    is_generated: entry.isGenerated,
    created_at: entry.createdAt.toISOString(),
    updated_at: entry.updatedAt.toISOString(),
  });
  
  if (error) throw error;
}

export async function updateJournalEntry(entry: JournalEntry): Promise<void> {
  const { error } = await supabase
    .from('journal_entries')
    .update({
      paper_ids: entry.paperIds,
      synthesis: entry.synthesis,
      key_insights: entry.keyInsights,
      is_generated: entry.isGenerated,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entry.id);
  
  if (error) throw error;
}

export async function deleteJournalEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from('journal_entries')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
}

// Settings operations
// OpenAI API key is stored in localStorage for security (never sent to cloud)
const OPENAI_KEY_STORAGE = 'paper-tracking-openai-key';

export async function getSettings(): Promise<AppSettings> {
  // Get OpenAI key from localStorage (secure, device-only)
  const localOpenAIKey = typeof window !== 'undefined' 
    ? localStorage.getItem(OPENAI_KEY_STORAGE) || undefined
    : undefined;
  
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('id', 1)
    .single();
  
  if (error) {
    console.warn('Error fetching settings:', error);
    return {
      openaiApiKey: localOpenAIKey,
      defaultHighlightColor: 'yellow' as HighlightColor,
      sidebarWidth: 320,
    };
  }
  
  return {
    openaiApiKey: localOpenAIKey, // From localStorage, not Supabase
    defaultHighlightColor: (data.default_highlight_color as HighlightColor) || 'yellow',
    sidebarWidth: 320,
    researchContext: data.research_context || undefined,
    sortOption: data.sort_option || 'recent',
  };
}

export async function updateSettings(settings: AppSettings): Promise<void> {
  // Store OpenAI key in localStorage only (never send to cloud)
  if (typeof window !== 'undefined') {
    if (settings.openaiApiKey) {
      localStorage.setItem(OPENAI_KEY_STORAGE, settings.openaiApiKey);
    } else {
      localStorage.removeItem(OPENAI_KEY_STORAGE);
    }
  }
  
  // Store other settings in Supabase (synced across devices)
  const { error } = await supabase
    .from('settings')
    .update({
      // Note: openai_api_key is NOT sent to Supabase anymore
      default_highlight_color: settings.defaultHighlightColor,
      research_context: settings.researchContext,
      sort_option: settings.sortOption,
    })
    .eq('id', 1);
  
  if (error) throw error;
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
