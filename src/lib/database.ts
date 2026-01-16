import { supabase } from './supabase';
import { getCachedPdf, cachePdf, deleteCachedPdf } from './pdfCache';
import type { Paper, PaperFile, Highlight, Note, FurtherReading, AppSettings, HighlightColor, JournalEntry, KeyInsight } from '../types';

let currentProjectId: string | undefined;

export function setDatabaseProjectId(id: string | undefined) {
  currentProjectId = id;
}

// Helper to get current project ID (returns default UUID if not set, to be safe)
function getProjectId(): string {
  // If no project selected, use the default one (all zeros UUID)
  return currentProjectId || '00000000-0000-0000-0000-000000000000';
}

// Helper to get current user ID from Supabase auth
async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

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
    projectId: row.project_id ? String(row.project_id) : undefined,
    authors: row.authors ? String(row.authors) : undefined,
    tags: tags,
    uploadedAt: row.created_at ? new Date(String(row.created_at)) : new Date(),
    createdAt: row.created_at ? new Date(String(row.created_at)) : new Date(),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)) : (row.created_at ? new Date(String(row.created_at)) : new Date()),
    lastOpenedAt: row.last_opened_at ? new Date(String(row.last_opened_at)) : undefined,
    isRead: Boolean(row.is_read),
    isStarred: Boolean(row.is_starred),
    isArchived: Boolean(row.is_archived),
    readingProgress: typeof row.reading_progress === 'number' ? row.reading_progress : 0,
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
    resolved: row.resolved as boolean ?? false,
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
export async function getAllPapers(projectId?: string): Promise<Paper[]> {
  const targetProjectId = projectId || getProjectId();

  const { data, error } = await supabase
    .from('papers')
    .select('*')
    .eq('project_id', targetProjectId)
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
  const targetProjectId = getProjectId();
  const userId = await getCurrentUserId();

  const { error } = await supabase.from('papers').insert({
    id: paper.id,
    project_id: targetProjectId,
    user_id: userId,
    title: paper.title,
    authors: paper.authors,
    tags: paper.tags,
    created_at: paper.uploadedAt.toISOString(),
    last_opened_at: paper.lastOpenedAt?.toISOString(),
    is_read: paper.isRead ?? false,
    is_starred: paper.isStarred ?? false,
    is_archived: paper.isArchived ?? false,
    reading_progress: paper.readingProgress ?? 0,
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
      is_archived: paper.isArchived ?? false,
      reading_progress: paper.readingProgress ?? 0,
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
      is_archived: paper.isArchived ?? false,
      reading_progress: paper.readingProgress ?? 0,
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

  // Delete from local cache
  await deleteCachedPdf(id);

  // Delete paper (cascades to highlights and notes)
  const { error } = await supabase
    .from('papers')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Archive/unarchive a paper
export async function archivePaper(id: string, isArchived: boolean): Promise<void> {
  // First get current metadata
  const { data: existing } = await supabase
    .from('papers')
    .select('metadata')
    .eq('id', id)
    .single();

  const updatedMetadata: Record<string, any> = { ...(existing?.metadata || {}) };

  if (isArchived) {
    updatedMetadata.archivedAt = new Date().toISOString();
  } else {
    delete updatedMetadata.archivedAt;
  }

  const { error } = await supabase
    .from('papers')
    .update({
      is_archived: isArchived,
      metadata: updatedMetadata
    })
    .eq('id', id);

  if (error) {
    console.error('[Database] Error archiving paper:', id, error);
    throw error;
  }
}

// Paper file operations - using Supabase Storage with IndexedDB caching
export async function getPaperFile(paperId: string): Promise<PaperFile | undefined> {
  const startTime = Date.now();

  // Check cache first
  const cachedData = await getCachedPdf(paperId);
  if (cachedData && cachedData.byteLength > 0) {
    console.log(`[Database] PDF loaded from cache in ${Date.now() - startTime}ms, size: ${cachedData.byteLength} bytes`);
    return {
      id: paperId,
      paperId: paperId,
      data: cachedData,
    };
  }

  // Cache miss - download from Supabase
  console.log(`[Database] Downloading PDF for paper ${paperId}...`);

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

  // Cache the downloaded PDF for future use
  cachePdf(paperId, arrayBuffer).catch(() => {
    // Caching failure is non-critical, already logged in cachePdf
  });

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
  // Highlights are linked to papers, so we don't strictly need project_id check here 
  // if we assume papers are correctly isolated. But for safety/completeness we could add it.
  // For now, simple paper_id check is enough as paper_id is unique across all projects.
  const { data, error } = await supabase
    .from('highlights')
    .select('*')
    .eq('paper_id', paperId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(rowToHighlight);
}

export async function addHighlight(highlight: Highlight): Promise<void> {
  const targetProjectId = getProjectId();
  const userId = await getCurrentUserId();

  const { error } = await supabase.from('highlights').insert({
    id: highlight.id,
    project_id: targetProjectId,
    user_id: userId,
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
      resolved: highlight.resolved ?? false,
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

// Reassign all highlights from one paper to another (for fixing mis-assigned highlights)
export async function reassignHighlights(fromPaperId: string, toPaperId: string): Promise<number> {
  const { data, error } = await supabase
    .from('highlights')
    .update({ paper_id: toPaperId })
    .eq('paper_id', fromPaperId)
    .select('id');

  if (error) throw error;
  
  // Also update notes that reference these highlights
  if (data && data.length > 0) {
    await supabase
      .from('notes')
      .update({ paper_id: toPaperId })
      .eq('paper_id', fromPaperId);
  }
  
  return data?.length || 0;
}

export async function getAllFurtherReadingHighlights(projectId?: string): Promise<Highlight[]> {
  const targetProjectId = projectId || getProjectId();

  const { data, error } = await supabase
    .from('highlights')
    .select('*')
    .eq('project_id', targetProjectId)
    .eq('is_further_reading', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToHighlight);
}

export async function getAllHighlightsByProject(projectId?: string): Promise<Highlight[]> {
  const targetProjectId = projectId || getProjectId();

  const { data, error } = await supabase
    .from('highlights')
    .select('*')
    .eq('project_id', targetProjectId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToHighlight);
}

// Note operations
export async function getAllNotes(projectId?: string): Promise<Note[]> {
  const targetProjectId = projectId || getProjectId();

  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('project_id', targetProjectId)
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
  const targetProjectId = getProjectId();
  const userId = await getCurrentUserId();

  const { error } = await supabase.from('notes').insert({
    id: note.id,
    project_id: targetProjectId,
    user_id: userId,
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



// ============================================================================
// Literature Review Operations
// ============================================================================

import type {
  LitReviewSheet,
  LitReviewRow,
  LitReviewVersion,
  LitReviewColumn,
  LitReviewCell,
} from '../types/litreview';

// Get all sheets for a project
export async function getLitReviewSheets(projectId: string): Promise<LitReviewSheet[]> {
  const userId = await getCurrentUserId();
  
  const { data: sheetsData, error: sheetsError } = await supabase
    .from('lit_review_sheets')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (sheetsError) throw sheetsError;
  if (!sheetsData) return [];

  // For each sheet, get its rows and versions
  const sheets: LitReviewSheet[] = await Promise.all(
    sheetsData.map(async (sheet) => {
      const [rowsResult, versionsResult] = await Promise.all([
        supabase
          .from('lit_review_rows')
          .select('*')
          .eq('sheet_id', sheet.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('lit_review_versions')
          .select('*')
          .eq('sheet_id', sheet.id)
          .order('created_at', { ascending: true }),
      ]);

      const rows: LitReviewRow[] = (rowsResult.data || []).map((row) => ({
        id: row.id,
        paperId: row.paper_id,
        paperTitle: row.paper_title,
        cells: row.cells as Record<string, LitReviewCell>,
        status: row.status as LitReviewRow['status'],
        errorMessage: row.error_message,
        extractedAt: row.extracted_at ? new Date(row.extracted_at) : undefined,
      }));

      const versions: LitReviewVersion[] = (versionsResult.data || []).map((v) => ({
        id: v.id,
        name: v.name,
        createdAt: new Date(v.created_at),
        columns: v.columns as LitReviewColumn[],
        rows: v.rows as LitReviewRow[],
      }));

      return {
        id: sheet.id,
        projectId: sheet.project_id,
        name: sheet.name,
        columns: sheet.columns as LitReviewColumn[],
        rows,
        versions,
        selectedPaperIds: sheet.selected_paper_ids || [],
        currentVersionId: sheet.current_version_id,
        createdAt: new Date(sheet.created_at),
        updatedAt: new Date(sheet.updated_at),
      };
    })
  );

  return sheets;
}

// Create a new sheet
export async function createLitReviewSheet(
  projectId: string,
  name: string
): Promise<LitReviewSheet> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('lit_review_sheets')
    .insert({
      project_id: projectId,
      user_id: userId,
      name,
      columns: [],
      selected_paper_ids: [],
    })
    .select()
    .single();

  if (error) throw error;

  return {
    id: data.id,
    projectId: data.project_id,
    name: data.name,
    columns: [],
    rows: [],
    versions: [],
    selectedPaperIds: [],
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

// Update a sheet (columns, name, selectedPaperIds)
export async function updateLitReviewSheet(sheet: LitReviewSheet): Promise<void> {
  const { error } = await supabase
    .from('lit_review_sheets')
    .update({
      name: sheet.name,
      columns: sheet.columns,
      selected_paper_ids: sheet.selectedPaperIds,
      current_version_id: sheet.currentVersionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sheet.id);

  if (error) throw error;
}

// Delete a sheet
export async function deleteLitReviewSheet(sheetId: string): Promise<void> {
  const { error } = await supabase
    .from('lit_review_sheets')
    .delete()
    .eq('id', sheetId);

  if (error) throw error;
}

// Add or update a row
export async function upsertLitReviewRow(
  sheetId: string,
  row: LitReviewRow
): Promise<void> {
  const { error } = await supabase
    .from('lit_review_rows')
    .upsert({
      id: row.id,
      sheet_id: sheetId,
      paper_id: row.paperId,
      paper_title: row.paperTitle,
      cells: row.cells,
      status: row.status,
      error_message: row.errorMessage,
      extracted_at: row.extractedAt?.toISOString(),
    }, { onConflict: 'sheet_id,paper_id' });

  if (error) throw error;
}

// Delete a row
export async function deleteLitReviewRow(rowId: string): Promise<void> {
  const { error } = await supabase
    .from('lit_review_rows')
    .delete()
    .eq('id', rowId);

  if (error) throw error;
}

// Delete rows by paper ID for a sheet
export async function deleteLitReviewRowByPaper(
  sheetId: string,
  paperId: string
): Promise<void> {
  const { error } = await supabase
    .from('lit_review_rows')
    .delete()
    .eq('sheet_id', sheetId)
    .eq('paper_id', paperId);

  if (error) throw error;
}

// Save a version snapshot
export async function saveLitReviewVersion(
  sheetId: string,
  version: LitReviewVersion
): Promise<void> {
  const { error } = await supabase
    .from('lit_review_versions')
    .insert({
      id: version.id,
      sheet_id: sheetId,
      name: version.name,
      columns: version.columns,
      rows: version.rows,
    });

  if (error) throw error;
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
function parseKeyInsight(item: unknown, index: number): KeyInsight {
  // Handle stringified JSON objects
  let parsed = item;

  if (typeof item === 'string') {
    // Check if it's a JSON string that looks like an object
    const trimmed = item.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Not valid JSON, treat as plain text
        return { id: `legacy-${index}`, text: item, isManual: false };
      }
    } else {
      // Old format: plain string - treat as AI-generated
      return { id: `legacy-${index}`, text: item, isManual: false };
    }
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;

    // Extract text - handle various formats
    let text = '';
    if (typeof obj.text === 'string') {
      text = obj.text;
    } else if (typeof obj.text === 'object' && obj.text !== null) {
      // Nested object case - recurse
      const nestedResult = parseKeyInsight(obj.text, index);
      text = nestedResult.text;
    }

    return {
      id: (typeof obj.id === 'string' ? obj.id : null) || `insight-${index}`,
      text,
      isManual: Boolean(obj.isManual),
      paperId: typeof obj.paperId === 'string' ? obj.paperId : undefined,
    };
  }

  return { id: `unknown-${index}`, text: String(item), isManual: false };
}

function rowToJournalEntry(row: Record<string, unknown>): JournalEntry {
  // Handle migration from old string[] format to new KeyInsight[] format
  const rawInsights = row.key_insights as unknown[];
  let keyInsights: KeyInsight[] = [];

  if (Array.isArray(rawInsights)) {
    keyInsights = rawInsights.map((item, index) => parseKeyInsight(item, index));
  }

  return {
    id: row.id as string,
    date: row.date as string,
    paperIds: (row.paper_ids as string[]) || [],
    synthesis: (row.synthesis as string) || '',
    keyInsights,
    isGenerated: Boolean(row.is_generated),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export async function getAllJournalEntries(projectId?: string): Promise<JournalEntry[]> {
  const targetProjectId = projectId || getProjectId();

  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('project_id', targetProjectId)
    .order('date', { ascending: false });

  if (error) {
    console.error('[Database] Error fetching journal entries:', error);
    return [];
  }

  return (data || []).map(rowToJournalEntry);
}

export async function getJournalEntry(date: string): Promise<JournalEntry | undefined> {
  const targetProjectId = getProjectId();
  
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('date', date)
    .eq('project_id', targetProjectId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return undefined; // Not found
    console.error('[Database] Error fetching journal entry:', error);
    return undefined;
  }
  return data ? rowToJournalEntry(data) : undefined;
}

export async function addJournalEntry(entry: JournalEntry): Promise<void> {
  const targetProjectId = getProjectId();
  const userId = await getCurrentUserId();

  const { error } = await supabase.from('journal_entries').insert({
    id: entry.id,
    project_id: targetProjectId,
    user_id: userId,
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

export async function getSettings(projectId?: string): Promise<AppSettings> {
  // Get OpenAI key from localStorage (secure, device-only)
  const localOpenAIKey = typeof window !== 'undefined'
    ? localStorage.getItem(OPENAI_KEY_STORAGE) || undefined
    : undefined;

  const targetProjectId = projectId || getProjectId();

  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('project_id', targetProjectId)
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

export async function updateSettings(settings: AppSettings, projectId?: string): Promise<void> {
  // Store OpenAI key in localStorage only (never send to cloud)
  if (typeof window !== 'undefined') {
    if (settings.openaiApiKey) {
      localStorage.setItem(OPENAI_KEY_STORAGE, settings.openaiApiKey);
    } else {
      localStorage.removeItem(OPENAI_KEY_STORAGE);
    }
  }

  // Store other settings in Supabase (synced across devices, per project)
  const targetProjectId = projectId || getProjectId();

  // Try UPDATE first (most common case - settings already exist)
  const updateResult = await supabase
    .from('settings')
    .update({
      default_highlight_color: settings.defaultHighlightColor,
      research_context: settings.researchContext,
      sort_option: settings.sortOption,
    })
    .eq('project_id', targetProjectId)
    .select();

  // If update succeeded and affected rows, we're done
  if (!updateResult.error && updateResult.data && updateResult.data.length > 0) {
    return;
  }

  // If no rows updated (row doesn't exist), try INSERT
  if (!updateResult.error && updateResult.data && updateResult.data.length === 0) {
    const userId = await getCurrentUserId();
    const insertResult = await supabase
      .from('settings')
      .insert({
        project_id: targetProjectId,
        user_id: userId,
        default_highlight_color: settings.defaultHighlightColor,
        research_context: settings.researchContext,
        sort_option: settings.sortOption,
      })
      .select();

    if (insertResult.error) throw insertResult.error;
    return;
  }

  // If update had an error, throw it
  if (updateResult.error) throw updateResult.error;
}

// Get all unique tags
export async function getAllTags(projectId?: string): Promise<string[]> {
  const papers = await getAllPapers(projectId);
  const tagSet = new Set<string>();
  papers.forEach(paper => {
    paper.tags.forEach(tag => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}
