import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  ArrowLeft,
  Plus,
  FileSpreadsheet,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Download,
  History,
  Settings2,
  Trash2,
  Check,
  X,
  Sparkles,
  FileText,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Copy,
  MoreHorizontal,
  Columns,
  Save,
  ExternalLink,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import {
  getAllPapers,
  getSettings,
  getPaperFile,
  getLitReviewSheets,
  createLitReviewSheet,
  updateLitReviewSheet,
  deleteLitReviewSheet,
  upsertLitReviewRow,
  deleteLitReviewRowByPaper,
  saveLitReviewVersion,
} from '../lib/database';
import { extractTextFromPDF } from '../lib/openai';
import type { Paper, AppSettings } from '../types';
import type {
  LitReviewSheet,
  LitReviewColumn,
  LitReviewRow,
  LitReviewCell,
  LitReviewVersion,
  LitReviewPreset,
  LitReviewColumnType,
  LitReviewColumnOption,
} from '../types/litreview';
import { DEFAULT_PRESETS, LITREVIEW_STORAGE_KEY } from '../types/litreview';

// ============================================================================
// Temporary localStorage fallback (until Supabase tables are created)
// ============================================================================

function getStorageKey(projectId: string): string {
  return `${LITREVIEW_STORAGE_KEY}_${projectId}`;
}

function loadSheetsFromStorage(projectId: string): LitReviewSheet[] {
  try {
    const data = localStorage.getItem(getStorageKey(projectId));
    if (!data) return [];
    const sheets = JSON.parse(data) as LitReviewSheet[];
    return sheets.map(sheet => ({
      ...sheet,
      createdAt: new Date(sheet.createdAt),
      updatedAt: new Date(sheet.updatedAt),
      versions: sheet.versions.map(v => ({
        ...v,
        createdAt: new Date(v.createdAt),
      })),
      rows: sheet.rows.map(r => ({
        ...r,
        extractedAt: r.extractedAt ? new Date(r.extractedAt) : undefined,
      })),
    }));
  } catch {
    return [];
  }
}

function saveSheetsToStorage(projectId: string, sheets: LitReviewSheet[]): void {
  localStorage.setItem(getStorageKey(projectId), JSON.stringify(sheets));
}

// ============================================================================
// AI Extraction Utilities
// ============================================================================

async function extractColumnValue(
  paperText: string,
  column: LitReviewColumn,
  model: ModelId = 'gpt-4o-mini'
): Promise<LitReviewCell> {
  const systemPrompt = `You are an expert research paper analyst. Extract specific information from academic papers with high accuracy.
Your task is to find and extract: "${column.name}"
Description: ${column.description}

${column.type === 'select' && column.options ? 
  `IMPORTANT: Your answer MUST be exactly one of these options: ${column.options.map(o => o.label).join(', ')}
If none fit well, choose the closest match or "Other" if available.` : ''}

${column.type === 'multiselect' && column.options ? 
  `IMPORTANT: Your answer MUST be a comma-separated list of ONLY these options: ${column.options.map(o => o.label).join(', ')}
Only include options that clearly apply.` : ''}

${column.type === 'number' ? 
  `IMPORTANT: Your answer MUST be a number only (no units, no text). If no number is found, respond with "N/A".` : ''}

${column.type === 'boolean' ? 
  `IMPORTANT: Your answer MUST be exactly "Yes" or "No".` : ''}

Respond in this exact JSON format:
{
  "value": "<extracted value>",
  "confidence": <0.0-1.0>,
  "sourceText": "<brief quote from paper supporting this, max 100 chars>"
}`;

  try {
    const data = await callOpenAIWithFallback([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Paper text (truncated to first 15000 chars for context):\n\n${paperText.slice(0, 15000)}` },
    ], { model, temperature: 0.1 });

    const result = JSON.parse(data.choices[0].message.content);

    let value: LitReviewCell['value'] = result.value;
    
    // Type conversion
    if (column.type === 'number') {
      const num = parseFloat(result.value);
      value = isNaN(num) ? null : num;
    } else if (column.type === 'boolean') {
      value = result.value?.toLowerCase() === 'yes';
    } else if (column.type === 'multiselect') {
      value = result.value.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    return {
      value,
      confidence: result.confidence || 0.5,
      sourceText: result.sourceText,
    };
  } catch (error) {
    console.error('Extraction error:', error);
    return { value: null, confidence: 0 };
  }
}

// ============================================================================
// Sub-Components
// ============================================================================

interface PaperListPanelProps {
  papers: Paper[];
  inSheetPaperIds: Set<string>; // Papers already in the sheet
  stagedPaperIds: Set<string>; // Papers selected for addition
  isPreview: boolean;
  onToggleStaged: (paperId: string) => void;
  onStageAll: () => void;
  onClearStaged: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterTag: string | null;
  onFilterTagChange: (tag: string | null) => void;
  allTags: string[];
}

function PaperListPanel({
  papers,
  inSheetPaperIds,
  stagedPaperIds,
  isPreview,
  onToggleStaged,
  onStageAll,
  onClearStaged,
  searchQuery,
  onSearchChange,
  filterTag,
  onFilterTagChange,
  allTags,
}: PaperListPanelProps) {
  const [showTagFilter, setShowTagFilter] = useState(false);

  const filteredPapers = useMemo(() => {
    return papers.filter(p => {
      const matchesSearch = !searchQuery || 
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.authors?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTag = !filterTag || p.tags.includes(filterTag);
      return matchesSearch && matchesTag;
    });
  }, [papers, searchQuery, filterTag]);

  const stagedCount = stagedPaperIds.size;
  const inSheetCount = inSheetPaperIds.size;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] border-r border-[var(--border-default)]">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border-default)]">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Papers</h2>
        
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search papers..."
            disabled={isPreview}
            className={`w-full pl-10 pr-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/30 ${
              isPreview ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          />
        </div>

        {/* Filter */}
        <div className="relative">
          <button
            onClick={() => setShowTagFilter(!showTagFilter)}
            disabled={isPreview}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              filterTag ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            } ${isPreview ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <Filter className="w-3.5 h-3.5" />
            {filterTag || 'Filter by tag'}
            <ChevronDown className="w-3 h-3" />
          </button>

          {showTagFilter && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-[#252529] border border-[var(--border-default)] rounded-lg shadow-xl z-10 py-1 max-h-48 overflow-y-auto">
              <button
                onClick={() => { onFilterTagChange(null); setShowTagFilter(false); }}
                className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              >
                All papers
              </button>
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => { onFilterTagChange(tag); setShowTagFilter(false); }}
                  className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-tertiary)] ${
                    filterTag === tag ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Selection controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-tertiary)]/50 border-b border-[var(--border-default)]">
        <span className="text-xs text-[var(--text-muted)]">
          {inSheetCount} in sheet{stagedCount > 0 && `, ${stagedCount} staged`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={onStageAll}
            disabled={isPreview}
            className={`text-xs text-[var(--accent-primary)] hover:text-[var(--accent-primary)] ${isPreview ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            Stage all
          </button>
          {stagedCount > 0 && (
            <button
              onClick={onClearStaged}
              disabled={isPreview}
              className={`text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] ${isPreview ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Paper list */}
      <div className="flex-1 overflow-y-auto">
        {filteredPapers.map((paper) => {
          const isInSheet = inSheetPaperIds.has(paper.id);
          const isStaged = stagedPaperIds.has(paper.id);
          return (
            <div
              key={paper.id}
              onClick={() => !isPreview && !isInSheet && onToggleStaged(paper.id)}
              className={`flex items-start gap-3 px-4 py-3 border-b border-[var(--border-muted)] transition-colors ${
                isInSheet 
                  ? 'bg-[var(--accent-green-bg)]/10 cursor-default' 
                  : isStaged 
                    ? 'bg-[var(--accent-primary)]/10 cursor-pointer' 
                    : 'hover:bg-[var(--bg-tertiary)] cursor-pointer'
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-colors ${
                isInSheet 
                  ? 'bg-[var(--accent-green-bg)]/25 text-[var(--accent-green)]' 
                  : isStaged 
                    ? 'bg-[var(--accent-primary)] border border-[var(--accent-primary)]' 
                    : 'border border-[var(--border-default)]'
              }`}>
                {isInSheet ? (
                  <Check className="w-3 h-3" />
                ) : isStaged ? (
                  <Check className="w-3 h-3 text-white" />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-[var(--text-primary)] line-clamp-2 leading-snug">
                    {paper.title}
                  </p>
                  {isInSheet && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] bg-[var(--accent-green-bg)]/20 text-[var(--accent-green)] font-medium rounded">
                      In sheet
                    </span>
                  )}
                </div>
                {paper.authors && (
                  <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
                    {paper.authors}
                  </p>
                )}
                {paper.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {paper.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="px-1.5 py-0.5 text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded">
                        {tag}
                      </span>
                    ))}
                    {paper.tags.length > 2 && (
                      <span className="text-[10px] text-[var(--text-muted)]">+{paper.tags.length - 2}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Column configuration component
interface ColumnConfigProps {
  column: LitReviewColumn;
  onUpdate: (column: LitReviewColumn) => void;
  onDelete: () => void;
  onClose: () => void;
}

function ColumnConfig({ column, onUpdate, onDelete, onClose }: ColumnConfigProps) {
  const [localColumn, setLocalColumn] = useState(column);
  const [newOption, setNewOption] = useState('');

  const typeOptions: { value: LitReviewColumnType; label: string }[] = [
    { value: 'text', label: 'Text' },
    { value: 'select', label: 'Single Select' },
    { value: 'multiselect', label: 'Multi Select' },
    { value: 'number', label: 'Number' },
    { value: 'boolean', label: 'Yes/No' },
  ];

  const handleAddOption = () => {
    if (!newOption.trim()) return;
    const option: LitReviewColumnOption = {
      id: uuidv4(),
      label: newOption.trim(),
      color: `hsl(${Math.random() * 360}, 60%, 50%)`,
    };
    setLocalColumn({
      ...localColumn,
      options: [...(localColumn.options || []), option],
    });
    setNewOption('');
  };

  const handleRemoveOption = (optionId: string) => {
    setLocalColumn({
      ...localColumn,
      options: localColumn.options?.filter(o => o.id !== optionId),
    });
  };

  const handleSave = () => {
    onUpdate(localColumn);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)]">
          <h3 className="text-lg font-medium text-[var(--text-primary)]">Configure Column</h3>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Column Name</label>
            <input
              type="text"
              value={localColumn.name}
              onChange={(e) => setLocalColumn({ ...localColumn, name: e.target.value })}
              className="w-full px-4 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/30"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Data Type</label>
            <select
              value={localColumn.type}
              onChange={(e) => setLocalColumn({ 
                ...localColumn, 
                type: e.target.value as LitReviewColumnType,
                options: ['select', 'multiselect'].includes(e.target.value) ? localColumn.options || [] : undefined,
              })}
              className="w-full px-4 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/30"
            >
              {typeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Description / AI Prompt */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">
              Extraction Prompt
              <span className="text-[var(--text-muted)] font-normal ml-1">(What should AI look for?)</span>
            </label>
            <textarea
              value={localColumn.description}
              onChange={(e) => setLocalColumn({ ...localColumn, description: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/30"
              placeholder="e.g., What type of study was conducted? Look for methodology section."
            />
          </div>

          {/* Options for select/multiselect */}
          {(localColumn.type === 'select' || localColumn.type === 'multiselect') && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Options</label>
              <div className="space-y-2">
                {localColumn.options?.map((opt) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: opt.color }}
                    />
                    <span className="flex-1 text-sm text-[var(--text-primary)]">{opt.label}</span>
                    <button
                      onClick={() => handleRemoveOption(opt.id)}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-red)]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newOption}
                    onChange={(e) => setNewOption(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddOption()}
                    placeholder="Add option..."
                    className="flex-1 px-3 py-1.5 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/30"
                  />
                  <button
                    onClick={handleAddOption}
                    className="px-3 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg text-sm hover:bg-[var(--bg-tertiary)]"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Width */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Column Width</label>
            <input
              type="number"
              value={localColumn.width}
              onChange={(e) => setLocalColumn({ ...localColumn, width: parseInt(e.target.value) || 150 })}
              min={80}
              max={500}
              className="w-24 px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/30"
            />
            <span className="ml-2 text-xs text-[var(--text-muted)]">px</span>
          </div>
        </div>

        <div className="flex items-center justify-between p-5 border-t border-[var(--border-default)]">
          <button
            onClick={onDelete}
            className="px-4 py-2 text-sm text-[var(--accent-red)] hover:text-[var(--accent-red)]"
          >
            Delete Column
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Available OpenAI models with their characteristics
const OPENAI_MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast & affordable', isReasoning: false },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Best quality', isReasoning: false },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Fast GPT-4', isReasoning: false },
  { id: 'o1-mini', name: 'o1-mini', description: 'Fast reasoning', isReasoning: true },
  { id: 'o1', name: 'o1', description: 'Advanced reasoning', isReasoning: true },
  { id: 'o3-mini', name: 'o3-mini', description: 'Latest reasoning', isReasoning: true },
] as const;

type ModelId = typeof OPENAI_MODELS[number]['id'];

// Helper to call OpenAI (uses server-side in production, falls back to client-side in dev)
async function callOpenAIWithFallback(
  messages: { role: string; content: string }[],
  options: { model?: ModelId; temperature?: number; max_tokens?: number } = {}
): Promise<{ choices: { message: { content: string } }[] }> {
  const { model = 'gpt-4o-mini', temperature = 0.3, max_tokens = 2000 } = options;
  
  const modelInfo = OPENAI_MODELS.find(m => m.id === model);
  const isReasoningModel = modelInfo?.isReasoning ?? false;
  
  // Reasoning models (o1, o3) need different message format and don't support temperature
  let apiMessages = messages;
  let apiParams: Record<string, unknown> = { model, messages: apiMessages, max_tokens };
  
  if (isReasoningModel) {
    // For o1/o3: convert system messages to developer messages, no temperature
    apiMessages = messages.map(m => ({
      role: m.role === 'system' ? 'developer' : m.role,
      content: m.content,
    }));
    apiParams = { model, messages: apiMessages, max_completion_tokens: max_tokens };
  } else {
    // For GPT-4 models: use standard format with temperature
    apiParams = { model, messages, temperature, max_tokens };
  }
  
  // Try server-side API first
  try {
    const response = await fetch('/api/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiParams),
    });
    
    if (response.ok) {
      return await response.json();
    }
    
    // If server-side fails, check for client-side key
    console.warn('Server-side API failed, trying client-side fallback...');
  } catch (error) {
    console.warn('Server-side API error, trying client-side fallback...', error);
  }
  
  // Fallback: Try to use client-side API key from localStorage
  const localKey = localStorage.getItem('paper-tracking-openai-key');
  if (!localKey) {
    throw new Error('No API key available. In development, set your OpenAI key in Settings. In production, ensure OPENAI_API_KEY is set on Vercel.');
  }
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localKey}`,
    },
    body: JSON.stringify(apiParams),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI API error:', errorText);
    throw new Error(`OpenAI API request failed: ${response.status}`);
  }
  
  return await response.json();
}

// AI Prompt Generation for Multiple Columns (uses server-side API key)
async function generateColumnPrompts(
  columns: { name: string; type: LitReviewColumnType; options?: string[] }[]
): Promise<string[]> {
  const columnDescriptions = columns.map((col, i) => {
    let desc = `${i + 1}. "${col.name}" (${col.type})`;
    if (col.options?.length) {
      desc += ` - Options: ${col.options.join(', ')}`;
    }
    return desc;
  }).join('\n');

  const data = await callOpenAIWithFallback([
    {
      role: 'system',
      content: `You are an expert at creating precise extraction prompts for academic paper analysis. 
Given a list of column names and their data types, generate specific prompts that an AI should use to extract the relevant information from research papers.

Each prompt should be:
- Clear and specific about what to look for
- Include examples when helpful
- Account for cases where information might not be present
- Be appropriate for the data type (e.g., for numbers, ask for numeric values; for boolean, ask for yes/no)

For select/multiselect types with options, the prompt should guide the AI to choose from the provided options.`,
    },
    {
      role: 'user',
      content: `Generate extraction prompts for these columns that will be used to analyze research papers:

${columnDescriptions}

Return a JSON array of prompts in the same order as the columns. Each prompt should be a string.
Example response format: ["prompt for column 1", "prompt for column 2", ...]`,
    },
  ], { temperature: 0.3 });
  const content = data.choices?.[0]?.message?.content || '[]';
  
  // Parse the JSON array from the response
  const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(cleanContent);
  } catch {
    // If parsing fails, return empty prompts
    return columns.map(() => '');
  }
}

// AI Column Inference from Natural Language Descriptions
interface InferredColumn {
  name: string;
  type: LitReviewColumnType;
  description: string;
  options?: string[];
}

async function inferColumnsFromDescriptions(descriptions: string[]): Promise<InferredColumn[]> {
  const data = await callOpenAIWithFallback([
    {
      role: 'system',
      content: `You are an expert at designing data schemas for literature review analysis.

Given natural language descriptions of what information to extract from academic papers, you will:
1. Create a short, clear column NAME (2-4 words max)
2. Determine the best data TYPE:
   - "text" for free-form text answers
   - "number" for numeric values (sample size, year, count, etc.)
   - "boolean" for yes/no questions
   - "select" for single-choice from a list (if categories are mentioned or implied)
   - "multiselect" for multiple choices from a list
3. Write a precise extraction PROMPT that tells an AI exactly what to look for
4. If type is "select" or "multiselect", provide the OPTIONS array

Be intelligent about inferring types:
- Questions asking "what type/kind/category" → often "select"
- Questions asking "does the paper..." or "is there..." → "boolean"
- Questions about counts, sizes, years → "number"
- Questions about methods, findings, limitations → "text"`,
    },
    {
      role: 'user',
      content: `Convert these descriptions into structured columns for a literature review spreadsheet:

${descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Return a JSON array of objects with this structure:
[
  {
    "name": "Short Column Name",
    "type": "text|number|boolean|select|multiselect",
    "description": "Detailed extraction prompt for the AI",
    "options": ["Option 1", "Option 2"] // only for select/multiselect
  }
]`,
    },
  ], { temperature: 0.3 });

  const content = data.choices?.[0]?.message?.content || '[]';
  const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
  
  try {
    const parsed = JSON.parse(cleanContent);
    return parsed.map((col: InferredColumn) => ({
      name: col.name || 'Unnamed',
      type: (['text', 'number', 'boolean', 'select', 'multiselect'].includes(col.type) ? col.type : 'text') as LitReviewColumnType,
      description: col.description || '',
      options: col.options,
    }));
  } catch {
    // Fallback: treat each description as a text column
    return descriptions.map(desc => ({
      name: desc.slice(0, 30),
      type: 'text' as LitReviewColumnType,
      description: desc,
    }));
  }
}

// Multi-Column Add Modal
interface MultiColumnModalProps {
  onAddColumns: (columns: LitReviewColumn[]) => void;
  onClose: () => void;
}

interface ColumnDraft {
  id: string;
  name: string;
  type: LitReviewColumnType;
  options: string[];
  optionsText: string; // Raw text for the input field
  prompt: string;
}

function MultiColumnModal({ onAddColumns, onClose }: MultiColumnModalProps) {
  const [mode, setMode] = useState<'quick' | 'detailed'>('quick');
  const [quickText, setQuickText] = useState('');
  const [columns, setColumns] = useState<ColumnDraft[]>([
    { id: uuidv4(), name: '', type: 'text', options: [], optionsText: '', prompt: '' },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptsGenerated, setPromptsGenerated] = useState(false);

  const typeOptions: { value: LitReviewColumnType; label: string }[] = [
    { value: 'text', label: 'Text' },
    { value: 'select', label: 'Single Select' },
    { value: 'multiselect', label: 'Multi Select' },
    { value: 'number', label: 'Number' },
    { value: 'boolean', label: 'Yes/No' },
  ];

  const addColumn = () => {
    setColumns([...columns, { id: uuidv4(), name: '', type: 'text', options: [], optionsText: '', prompt: '' }]);
    setPromptsGenerated(false);
  };

  const removeColumn = (id: string) => {
    if (columns.length > 1) {
      setColumns(columns.filter(c => c.id !== id));
      setPromptsGenerated(false);
    }
  };

  const updateColumn = (id: string, updates: Partial<ColumnDraft>) => {
    setColumns(columns.map(c => c.id === id ? { ...c, ...updates } : c));
    if (!updates.prompt) {
      setPromptsGenerated(false);
    }
  };

  const handleGeneratePrompts = async () => {
    const validColumns = columns.filter(c => c.name.trim());
    if (validColumns.length === 0) {
      alert('Please add at least one column with a name');
      return;
    }

    setIsGenerating(true);
    try {
      const prompts = await generateColumnPrompts(
        validColumns.map(c => ({
          name: c.name,
          type: c.type,
          options: c.options.filter(o => o.trim()),
        }))
      );

      // Update columns with generated prompts
      let promptIndex = 0;
      setColumns(columns.map(c => {
        if (c.name.trim()) {
          return { ...c, prompt: prompts[promptIndex++] || '' };
        }
        return c;
      }));
      setPromptsGenerated(true);
    } catch (error) {
      console.error('Failed to generate prompts:', error);
      alert('Failed to generate prompts. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleQuickAdd = async () => {
    const descriptions = quickText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (descriptions.length === 0) {
      alert('Please enter at least one column description');
      return;
    }

    setIsGenerating(true);
    try {
      // AI infers column names, types, and prompts from descriptions
      const inferredColumns = await inferColumnsFromDescriptions(descriptions);

      // Create columns with inferred properties
      const newColumns: LitReviewColumn[] = inferredColumns.map(col => ({
        id: uuidv4(),
        name: col.name,
        type: col.type,
        description: col.description,
        options: col.options?.map(opt => ({
          id: uuidv4(),
          label: opt,
          color: `hsl(${Math.random() * 360}, 60%, 50%)`,
        })),
        width: col.type === 'text' ? 200 : 150,
      }));

      onAddColumns(newColumns);
      onClose();
    } catch (error) {
      console.error('Failed to infer columns:', error);
      alert('Failed to create columns. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    const validColumns = columns.filter(c => c.name.trim());
    if (validColumns.length === 0) {
      alert('Please add at least one column with a name');
      return;
    }

    const newColumns: LitReviewColumn[] = validColumns.map(c => ({
      id: c.id,
      name: c.name.trim(),
      type: c.type,
      description: c.prompt,
      options: ['select', 'multiselect'].includes(c.type) 
        ? c.options.filter(o => o.trim()).map(o => ({
            id: uuidv4(),
            label: o.trim(),
            color: `hsl(${Math.random() * 360}, 60%, 50%)`,
          }))
        : undefined,
      width: 150,
    }));

    onAddColumns(newColumns);
    onClose();
  };

  const quickColumnCount = quickText.split('\n').filter(l => l.trim()).length;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl w-full max-w-3xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col my-8">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)]">
          <div>
            <h3 className="text-lg font-medium text-[var(--text-primary)]">Add Multiple Columns</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">Define columns and let AI generate extraction prompts</p>
          </div>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-1 p-2 mx-5 mt-5 bg-[var(--bg-tertiary)] rounded-lg w-fit">
          <button
            onClick={() => setMode('quick')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              mode === 'quick' 
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' 
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            Quick
          </button>
          <button
            onClick={() => setMode('detailed')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              mode === 'detailed' 
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' 
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            Detailed
          </button>
        </div>

        {mode === 'quick' ? (
          /* Quick Mode - Natural language descriptions */
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-2">
                Describe what you want to extract (one per line)
              </label>
              <textarea
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                placeholder={`What research methodology was used (qualitative, quantitative, or mixed)?
How many participants were in the study?
What are the main findings?
Does the paper include a user study?
What limitations are mentioned by the authors?`}
                rows={10}
                className="w-full px-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-xl text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/30 resize-none"
              />
              <p className="text-xs text-[var(--text-muted)] mt-2">
                {quickColumnCount} column{quickColumnCount !== 1 ? 's' : ''} • AI will infer column names, types, and extraction prompts
              </p>
            </div>
          </div>
        ) : (
          /* Detailed Mode - Individual column configuration */
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {columns.map((column, index) => (
            <div
              key={column.id}
              className="p-4 bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border-default)] space-y-3"
            >
              <div className="flex items-start justify-between">
                <span className="text-xs font-medium text-[var(--text-muted)]">Column {index + 1}</span>
                {columns.length > 1 && (
                  <button
                    onClick={() => removeColumn(column.id)}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Name */}
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Name</label>
                  <input
                    type="text"
                    value={column.name}
                    onChange={(e) => updateColumn(column.id, { name: e.target.value })}
                    placeholder="e.g., Study Type"
                    className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/30"
                  />
                </div>

                {/* Type */}
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Type</label>
                  <select
                    value={column.type}
                    onChange={(e) => updateColumn(column.id, { 
                      type: e.target.value as LitReviewColumnType,
                      options: ['select', 'multiselect'].includes(e.target.value) ? column.options : [],
                      optionsText: ['select', 'multiselect'].includes(e.target.value) ? column.optionsText : '',
                    })}
                    className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/30"
                  >
                    {typeOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Options for select types */}
              {['select', 'multiselect'].includes(column.type) && (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Options (comma-separated)</label>
                  <input
                    type="text"
                    value={column.optionsText}
                    onChange={(e) => updateColumn(column.id, { 
                      optionsText: e.target.value,
                      options: e.target.value.split(',').map(o => o.trim()).filter(o => o),
                    })}
                    placeholder="e.g., Qualitative, Quantitative, Mixed"
                    className="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/30"
                  />
                </div>
              )}

              {/* AI Generated Prompt */}
              {promptsGenerated && column.prompt && (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-[var(--accent-purple)]" />
                      AI-Generated Prompt
                    </span>
                  </label>
                  <textarea
                    value={column.prompt}
                    onChange={(e) => updateColumn(column.id, { prompt: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 bg-[var(--accent-purple-bg)]/10 border border-[var(--accent-purple-bg)]/20 rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-purple-bg)]/50 resize-none"
                  />
                </div>
              )}
            </div>
          ))}

          {/* Add Column Button */}
          <button
            onClick={addColumn}
            className="w-full py-3 border-2 border-dashed border-[var(--border-default)] rounded-xl text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-white/20 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Another Column
          </button>
        </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
          {mode === 'detailed' && (
            <button
              onClick={handleGeneratePrompts}
              disabled={isGenerating || columns.every(c => !c.name.trim())}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-purple-bg)]/20 text-[var(--accent-purple)] rounded-lg hover:bg-[var(--accent-purple-bg)]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {promptsGenerated ? 'Regenerate Prompts' : 'Generate Prompts with AI'}
                </>
              )}
            </button>
          )}

          <div className={`flex gap-3 ${mode === 'quick' ? 'ml-auto' : ''}`}>
            <button
              onClick={onClose}
              disabled={isGenerating}
              className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              Cancel
            </button>
            {mode === 'quick' ? (
              <button
                onClick={handleQuickAdd}
                disabled={isGenerating || quickColumnCount === 0}
                className="flex items-center gap-2 px-5 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating Prompts...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Add {quickColumnCount} Column{quickColumnCount !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={columns.every(c => !c.name.trim())}
                className="px-5 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add {columns.filter(c => c.name.trim()).length} Column{columns.filter(c => c.name.trim()).length !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Editable Cell Component
interface EditableCellProps {
  cell: LitReviewCell | undefined;
  column: LitReviewColumn;
  rowStatus: LitReviewRow['status'];
  isSelected: boolean;
  isInRange: boolean;
  isEditing: boolean;
  isReadOnly: boolean;
  onSelect: (options?: { shiftKey?: boolean }) => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onUpdateValue: (value: LitReviewCell['value']) => void;
  onNavigate: (direction: 'up' | 'down' | 'left' | 'right', options?: { shiftKey?: boolean }) => void;
}

function EditableCell({ 
  cell, 
  column, 
  rowStatus, 
  isSelected, 
  isInRange,
  isEditing,
  isReadOnly,
  onSelect,
  onStartEdit,
  onEndEdit,
  onUpdateValue,
  onNavigate,
}: EditableCellProps) {
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>(null);
  const [editValue, setEditValue] = useState('');

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLTextAreaElement || inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [isEditing]);

  // Initialize edit value
  useEffect(() => {
    if (isEditing) {
      const val = cell?.value;
      if (Array.isArray(val)) {
        setEditValue(val.join(', '));
      } else if (val !== null && val !== undefined) {
        setEditValue(String(val));
      } else {
        setEditValue('');
      }
    }
  }, [isEditing, cell?.value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isEditing) {
      if (isReadOnly) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          onNavigate('up', { shiftKey: e.shiftKey });
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          onNavigate('down', { shiftKey: e.shiftKey });
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onNavigate('left', { shiftKey: e.shiftKey });
        } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
          e.preventDefault();
          onNavigate('right', { shiftKey: e.shiftKey });
        }
        return;
      }
      // Navigation when selected but not editing
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        onStartEdit();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onNavigate('up', { shiftKey: e.shiftKey });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onNavigate('down', { shiftKey: e.shiftKey });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onNavigate('left', { shiftKey: e.shiftKey });
      } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault();
        onNavigate('right', { shiftKey: e.shiftKey });
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // Start typing to edit
        onStartEdit();
      }
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveAndClose();
      onNavigate('down');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      saveAndClose();
      onNavigate(e.shiftKey ? 'left' : 'right');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onEndEdit();
    }
  };

  const saveAndClose = () => {
    let newValue: LitReviewCell['value'] = editValue;
    
    if (column.type === 'number') {
      const num = parseFloat(editValue);
      newValue = isNaN(num) ? null : num;
    } else if (column.type === 'boolean') {
      newValue = editValue.toLowerCase() === 'yes' || editValue.toLowerCase() === 'true' || editValue === '1';
    } else if (column.type === 'multiselect') {
      newValue = editValue.split(',').map(s => s.trim()).filter(Boolean);
    }
    
    onUpdateValue(newValue);
    onEndEdit();
  };

  // Processing state
    if (cell?.status === 'processing' || rowStatus === 'processing') {
    return (
      <div className="flex items-center justify-center h-full min-h-[40px]">
        <Loader2 className="w-4 h-4 text-[var(--accent-primary)] animate-spin" />
      </div>
    );
  }

  // Error state
    if (cell?.status === 'error' || rowStatus === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-[var(--accent-red)] text-xs min-h-[40px]">
        <AlertCircle className="w-3.5 h-3.5" />
        Error
      </div>
    );
  }

  const value = cell?.value;

  // Editing mode
  if (isEditing) {
    if (column.type === 'boolean') {
      return (
        <div className="relative h-full min-h-[40px]">
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={editValue.toLowerCase() === 'yes' || editValue.toLowerCase() === 'true' || editValue === '1' ? 'yes' : 'no'}
            onChange={(e) => {
              onUpdateValue(e.target.value === 'yes');
              onEndEdit();
            }}
            onBlur={onEndEdit}
            onKeyDown={handleInputKeyDown}
            className="absolute inset-0 w-full h-full bg-[var(--bg-tertiary)] border border-[var(--accent-primary)] rounded px-2 py-1 text-sm text-[var(--text-primary)] focus:outline-none"
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      );
    }

    if (column.type === 'select') {
      return (
        <div className="relative h-full min-h-[40px]">
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={editValue}
            onChange={(e) => {
              onUpdateValue(e.target.value);
              onEndEdit();
            }}
            onBlur={onEndEdit}
            onKeyDown={handleInputKeyDown}
            className="absolute inset-0 w-full h-full bg-[var(--bg-tertiary)] border border-[var(--accent-primary)] rounded px-2 py-1 text-sm text-[var(--text-primary)] focus:outline-none"
          >
            <option value="">Select...</option>
            {column.options?.map(opt => (
              <option key={opt.id} value={opt.label}>{opt.label}</option>
            ))}
          </select>
        </div>
      );
    }

    // Text / Number / Multiselect - use textarea for multiline
    return (
      <div className="relative h-full min-h-[60px]">
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveAndClose}
          onKeyDown={handleInputKeyDown}
          placeholder={column.type === 'multiselect' ? 'Comma separated...' : 'Type here...'}
          className="absolute inset-0 w-full h-full bg-[var(--bg-tertiary)] border border-[var(--accent-primary)] rounded px-2 py-1 text-sm text-[var(--text-primary)] focus:outline-none resize-none"
          rows={3}
        />
      </div>
    );
  }

  // Display mode
  const baseClasses = `min-h-[40px] w-full h-full px-2 py-2 cursor-pointer rounded transition-all relative ${
    isSelected 
      ? 'z-10 ring-2 ring-[var(--accent-primary)] bg-[var(--accent-primary)]/10' 
      : isInRange
        ? 'bg-[var(--accent-primary)]/5'
        : 'hover:bg-[var(--bg-tertiary)]'
  }`;

  const renderValue = () => {
    if (value === null || value === undefined) {
      return <span className="text-[var(--text-muted)] text-xs italic">Empty - click to edit</span>;
    }

    if (column.type === 'boolean') {
      return (
        <div className="flex items-center gap-2">
          {value ? (
            <CheckCircle2 className="w-4 h-4 text-[var(--accent-green)]" />
          ) : (
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          )}
          <span className="text-sm text-[var(--text-secondary)]">{value ? 'Yes' : 'No'}</span>
        </div>
      );
    }

    if (column.type === 'select' || column.type === 'multiselect') {
      const values = Array.isArray(value) ? value : [value];
      return (
        <div className="flex flex-wrap gap-1">
          {values.filter(Boolean).map((v, i) => {
            const option = column.options?.find(o => o.label === v);
            return (
              <span
                key={i}
                className="px-2 py-0.5 text-xs rounded-full"
                style={{
                  backgroundColor: option?.color ? `${option.color}20` : 'rgba(255,255,255,0.1)',
                  color: option?.color || 'rgba(255,255,255,0.8)',
                }}
              >
                {v}
              </span>
            );
          })}
        </div>
      );
    }

    if (column.type === 'number') {
      return <span className="text-sm text-[var(--text-primary)] font-mono">{value}</span>;
    }

    // Text - no line clamp, show full content
    return <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">{String(value)}</p>;
  };

  return (
    <div
      className={baseClasses}
      onClick={(e) => onSelect({ shiftKey: e.shiftKey })}
      onDoubleClick={isReadOnly ? undefined : onStartEdit}
      onKeyDown={handleKeyDown}
      tabIndex={isSelected ? 0 : -1}
      role="gridcell"
    >
      <div className="relative">
        {renderValue()}
      </div>
    </div>
  );
}

// Spreadsheet component
interface SpreadsheetProps {
  sheet: LitReviewSheet;
  papers: Paper[];
  onUpdateSheet: (sheet: LitReviewSheet) => void;
  onRunExtraction: (rowIds?: string[], forceRefresh?: boolean) => void;
  onRunColumnExtraction: (columnId: string) => void;
  onRemoveRow: (rowId: string) => void;
  isExtracting: boolean;
  isPreview: boolean;
  selectedModel: ModelId;
  onModelChange: (model: ModelId) => void;
  onSelectCell: (cell: { rowId: string; columnId: string } | null) => void;
}

function Spreadsheet({ sheet, papers, onUpdateSheet, onRunExtraction, onRunColumnExtraction, onRemoveRow, isExtracting, isPreview, selectedModel, onModelChange, onSelectCell }: SpreadsheetProps) {
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{ columnId: string; startX: number; startWidth: number } | null>(null);
  const [paperColumnWidth, setPaperColumnWidth] = useState(280);
  const [resizingPaperColumn, setResizingPaperColumn] = useState<{ startX: number; startWidth: number } | null>(null);
  const [showMultiColumnModal, setShowMultiColumnModal] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{ rowId: string; columnId: string } | null>(null);
  const [selectionRange, setSelectionRange] = useState<{
    startRowIndex: number;
    endRowIndex: number;
    startColIndex: number;
    endColIndex: number;
  } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const editingColumn = editingColumnId ? sheet.columns.find(c => c.id === editingColumnId) : null;

  // Handle cell value update
  const handleCellUpdate = useCallback((rowId: string, columnId: string, value: LitReviewCell['value']) => {
    onUpdateSheet({
      ...sheet,
      rows: sheet.rows.map(r => 
        r.id === rowId 
          ? { 
              ...r, 
              cells: { 
                ...r.cells, 
                [columnId]: { 
                  ...r.cells[columnId],
                  value, 
                  confidence: undefined, // User-edited, remove AI confidence
                  sourceText: undefined,
                  status: undefined,
                  aiValue: r.cells[columnId]?.aiValue ?? r.cells[columnId]?.value ?? null,
                } 
              } 
            } 
          : r
      ),
    });
  }, [sheet, onUpdateSheet]);

  // Handle keyboard navigation
  const handleNavigate = useCallback((direction: 'up' | 'down' | 'left' | 'right', options?: { shiftKey?: boolean }) => {
    if (!selectedCell) return;

    const rowIndex = sheet.rows.findIndex(r => r.id === selectedCell.rowId);
    const colIndex = sheet.columns.findIndex(c => c.id === selectedCell.columnId);

    let newRowIndex = rowIndex;
    let newColIndex = colIndex;

    switch (direction) {
      case 'up':
        newRowIndex = Math.max(0, rowIndex - 1);
        break;
      case 'down':
        newRowIndex = Math.min(sheet.rows.length - 1, rowIndex + 1);
        break;
      case 'left':
        newColIndex = Math.max(0, colIndex - 1);
        break;
      case 'right':
        newColIndex = Math.min(sheet.columns.length - 1, colIndex + 1);
        break;
    }

    if (newRowIndex !== rowIndex || newColIndex !== colIndex) {
      const newRow = sheet.rows[newRowIndex];
      const newCol = sheet.columns[newColIndex];
      if (newRow && newCol) {
        setSelectedCell({ rowId: newRow.id, columnId: newCol.id });
        setEditingCell(null);
        if (options?.shiftKey && selectionAnchor) {
          const startRowIndex = Math.min(
            sheet.rows.findIndex(r => r.id === selectionAnchor.rowId),
            newRowIndex
          );
          const endRowIndex = Math.max(
            sheet.rows.findIndex(r => r.id === selectionAnchor.rowId),
            newRowIndex
          );
          const startColIndex = Math.min(
            sheet.columns.findIndex(c => c.id === selectionAnchor.columnId),
            newColIndex
          );
          const endColIndex = Math.max(
            sheet.columns.findIndex(c => c.id === selectionAnchor.columnId),
            newColIndex
          );
          setSelectionRange({ startRowIndex, endRowIndex, startColIndex, endColIndex });
        } else {
          setSelectionAnchor({ rowId: newRow.id, columnId: newCol.id });
          setSelectionRange(null);
        }
      }
    }
  }, [selectedCell, sheet.rows, sheet.columns, selectionAnchor]);

  // Handle column resize
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizing.startX;
      const newWidth = Math.max(80, Math.min(500, resizing.startWidth + diff));
      onUpdateSheet({
        ...sheet,
        columns: sheet.columns.map(c => 
          c.id === resizing.columnId ? { ...c, width: newWidth } : c
        ),
      });
    };

    const handleMouseUp = () => setResizing(null);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, sheet, onUpdateSheet]);

  // Handle paper column resize
  useEffect(() => {
    if (!resizingPaperColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizingPaperColumn.startX;
      const newWidth = Math.max(150, Math.min(500, resizingPaperColumn.startWidth + diff));
      setPaperColumnWidth(newWidth);
    };

    const handleMouseUp = () => setResizingPaperColumn(null);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingPaperColumn]);

  useEffect(() => {
    onSelectCell(selectedCell);
  }, [selectedCell, onSelectCell]);

  const handleAddMultipleColumns = (newColumns: LitReviewColumn[]) => {
    if (isPreview) return;
    onUpdateSheet({
      ...sheet,
      columns: [...sheet.columns, ...newColumns],
    });
  };

  const handleAddColumn = () => {
    if (isPreview) return;
    const newColumn: LitReviewColumn = {
      id: uuidv4(),
      name: 'New Column',
      type: 'text',
      description: 'Describe what to extract...',
      width: 200,
    };
    onUpdateSheet({
      ...sheet,
      columns: [...sheet.columns, newColumn],
    });
    setEditingColumnId(newColumn.id);
  };

  const handleUpdateColumn = (column: LitReviewColumn) => {
    if (isPreview) return;
    onUpdateSheet({
      ...sheet,
      columns: sheet.columns.map(c => c.id === column.id ? column : c),
    });
  };

  const handleDeleteColumn = (columnId: string) => {
    if (isPreview) return;
    onUpdateSheet({
      ...sheet,
      columns: sheet.columns.filter(c => c.id !== columnId),
      rows: sheet.rows.map(r => ({
        ...r,
        cells: Object.fromEntries(
          Object.entries(r.cells).filter(([key]) => key !== columnId)
        ),
      })),
    });
    setEditingColumnId(null);
  };

  const totalWidth = paperColumnWidth + sheet.columns.reduce((sum, c) => sum + c.width, 0) + 50;

  // Clear selection when clicking on empty toolbar area
  const handleToolbarClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedCell(null);
      setSelectionAnchor(null);
      setSelectionRange(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-primary)] min-w-0 overflow-hidden">
      {/* Toolbar */}
      <div 
        className="flex items-center justify-between px-5 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-default)]"
        onClick={handleToolbarClick}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={handleAddColumn}
            disabled={isPreview}
            className={`flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-sm rounded-lg transition-colors ${
              isPreview ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            <Plus className="w-4 h-4" />
            Add Column
          </button>
          <button
            onClick={() => setShowMultiColumnModal(true)}
            disabled={isPreview}
            className={`flex items-center gap-2 px-3 py-1.5 bg-[var(--accent-purple-bg)]/10 hover:bg-[var(--accent-purple-bg)]/20 text-[var(--accent-purple)] text-sm rounded-lg transition-colors ${
              isPreview ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            <Columns className="w-4 h-4" />
            Add Multiple
          </button>
          <button
            onClick={() => !isPreview && onRunExtraction()}
            disabled={isPreview || isExtracting || sheet.columns.length === 0 || sheet.selectedPaperIds.length === 0}
            className={`flex items-center gap-2 px-4 py-1.5 text-sm rounded-lg transition-all ${
              isExtracting ? 'bg-blue-500/50 text-[var(--text-secondary)]' :
              sheet.columns.length === 0 || sheet.selectedPaperIds.length === 0 
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            {isExtracting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Run Extraction
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Model selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)]">Model:</span>
            <select
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value as ModelId)}
              disabled={isPreview}
              className={`px-2 py-1 text-xs bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] ${
                isPreview ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            >
              {OPENAI_MODELS.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.description})
                </option>
              ))}
            </select>
          </div>
          {isPreview && (
            <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-2 py-1 rounded-lg">
              Preview mode (read-only)
            </span>
          )}
          <span className="text-xs text-[var(--text-secondary)]">
            {sheet.rows.filter(r => r.status === 'completed').length} / {sheet.rows.length} rows complete
          </span>
        </div>
      </div>

      {/* Table */}
      <div ref={tableRef} className="flex-1 overflow-x-auto overflow-y-auto">
        <div style={{ minWidth: totalWidth }}>
          {/* Header */}
          <div className="flex sticky top-0 bg-[var(--bg-card)] z-10 border-b border-[var(--border-default)]">
            {/* Paper title column - fixed but resizable */}
            <div 
              className="sticky left-0 flex-shrink-0 px-4 py-3 bg-[var(--bg-card)] border-r border-[var(--border-default)] z-20 relative"
              style={{ width: paperColumnWidth }}
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--text-muted)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">Paper</span>
              </div>
              {/* Resize handle */}
              <div
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent-primary)]/50 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setResizingPaperColumn({ startX: e.clientX, startWidth: paperColumnWidth });
                }}
              />
            </div>

            {/* Dynamic columns */}
            {sheet.columns.map((column) => (
              <div
                key={column.id}
                style={{ width: column.width }}
                className="flex-shrink-0 px-3 py-3 border-r border-[var(--border-muted)] group relative"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => !isPreview && setEditingColumnId(column.id)}
                    disabled={isPreview}
                    className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors"
                  >
                    {column.name}
                    <Settings2 className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isPreview) {
                        onRunColumnExtraction(column.id);
                      }
                    }}
                    disabled={isPreview}
                    className={`p-1 text-[var(--text-muted)] hover:text-[var(--accent-primary)] rounded transition-colors opacity-0 group-hover:opacity-100 ${
                      isPreview ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                    title="Re-run this column for all rows"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{column.description}</p>

                {/* Resize handle */}
                <div
                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent-primary)]/50 transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setResizing({ columnId: column.id, startX: e.clientX, startWidth: column.width });
                  }}
                />
              </div>
            ))}

            {/* Add column button */}
            <div className="flex-shrink-0 w-[50px] px-2 py-3 flex items-center justify-center">
              <button
                onClick={handleAddColumn}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Rows */}
          {sheet.rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileSpreadsheet className="w-12 h-12 text-[var(--text-muted)] mb-4" />
              <p className="text-[var(--text-secondary)] mb-2">No papers selected</p>
              <p className="text-sm text-[var(--text-muted)]">Select papers from the left panel to add them to this sheet</p>
            </div>
          ) : (
            sheet.rows.map((row, rowIndex) => {
              const paper = papers.find(p => p.id === row.paperId);
              return (
                <div
                  key={row.id}
                  className={`group flex border-b border-[var(--border-muted)] hover:bg-[var(--accent-primary-muted)] transition-colors relative ${
                    rowIndex % 2 === 0 ? 'bg-transparent' : ''
                  }`}
                >
                  {/* Paper title - fixed but resizable */}
                  <div 
                    className="sticky left-0 flex-shrink-0 px-4 py-3 bg-[var(--bg-primary)] border-r border-[var(--border-default)] z-10"
                    style={{ width: paperColumnWidth }}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                        row.status === 'completed' ? 'bg-[var(--accent-green-bg)]' :
                        row.status === 'processing' ? 'bg-[var(--accent-primary)] animate-pulse' :
                        row.status === 'error' ? 'bg-[var(--accent-red-bg)]' : 'bg-[var(--text-muted)]'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--text-primary)]">{row.paperTitle}</p>
                        {paper?.metadata?.venue && (
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">{paper.metadata.venue}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <a
                          href={`/reader/${row.paperId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-primary)] rounded transition-colors"
                          title="Open paper in new tab"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={() => onRunExtraction([row.id])}
                          disabled={isPreview || isExtracting}
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded transition-colors disabled:opacity-30"
                          title="Re-run extraction for this row"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (isPreview) return;
                            if (confirm('Remove this paper from the sheet?')) {
                              onRemoveRow(row.id);
                            }
                          }}
                          disabled={isPreview}
                          className={`p-1 text-[var(--text-muted)] hover:text-[var(--accent-red)] rounded transition-colors ${
                            isPreview ? 'opacity-40 cursor-not-allowed' : ''
                          }`}
                          title="Remove from sheet"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Data cells */}
                  {sheet.columns.map((column, columnIndex) => {
                    const isInRange = selectionRange
                      ? rowIndex >= selectionRange.startRowIndex &&
                        rowIndex <= selectionRange.endRowIndex &&
                        columnIndex >= selectionRange.startColIndex &&
                        columnIndex <= selectionRange.endColIndex
                      : false;
                    return (
                    <div
                      key={column.id}
                      style={{ width: column.width, minWidth: column.width }}
                      className="flex-shrink-0 border-r border-[var(--border-muted)] overflow-visible"
                    >
                      <EditableCell
                        cell={row.cells[column.id]}
                        column={column}
                        rowStatus={row.status}
                        isSelected={selectedCell?.rowId === row.id && selectedCell?.columnId === column.id}
                        isInRange={isInRange}
                        isEditing={editingCell?.rowId === row.id && editingCell?.columnId === column.id}
                        onSelect={(options) => {
                          // If clicking the same cell that's already selected, deselect
                          if (selectedCell?.rowId === row.id && selectedCell?.columnId === column.id && !options?.shiftKey) {
                            setSelectedCell(null);
                            setSelectionAnchor(null);
                            setSelectionRange(null);
                            return;
                          }
                          setSelectedCell({ rowId: row.id, columnId: column.id });
                          setEditingCell(null);
                          if (options?.shiftKey && selectionAnchor) {
                            const startRowIndex = Math.min(
                              sheet.rows.findIndex(r => r.id === selectionAnchor.rowId),
                              rowIndex
                            );
                            const endRowIndex = Math.max(
                              sheet.rows.findIndex(r => r.id === selectionAnchor.rowId),
                              rowIndex
                            );
                            const startColIndex = Math.min(
                              sheet.columns.findIndex(c => c.id === selectionAnchor.columnId),
                              columnIndex
                            );
                            const endColIndex = Math.max(
                              sheet.columns.findIndex(c => c.id === selectionAnchor.columnId),
                              columnIndex
                            );
                            setSelectionRange({ startRowIndex, endRowIndex, startColIndex, endColIndex });
                          } else {
                            setSelectionAnchor({ rowId: row.id, columnId: column.id });
                            setSelectionRange(null);
                          }
                        }}
                        onStartEdit={() => {
                          if (isPreview) return;
                          setSelectedCell({ rowId: row.id, columnId: column.id });
                          setEditingCell({ rowId: row.id, columnId: column.id });
                          setSelectionAnchor({ rowId: row.id, columnId: column.id });
                          setSelectionRange(null);
                        }}
                        onEndEdit={() => setEditingCell(null)}
                        onUpdateValue={(value) => handleCellUpdate(row.id, column.id, value)}
                        onNavigate={handleNavigate}
                        isReadOnly={isPreview}
                      />
                    </div>
                  )})}

                  {/* Spacer */}
                  <div className="flex-shrink-0 w-[50px]" />

                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Column config modal */}
      {!isPreview && editingColumn && (
        <ColumnConfig
          column={editingColumn}
          onUpdate={handleUpdateColumn}
          onDelete={() => handleDeleteColumn(editingColumn.id)}
          onClose={() => setEditingColumnId(null)}
        />
      )}

      {/* Multi-column add modal */}
      {!isPreview && showMultiColumnModal && (
        <MultiColumnModal
          onAddColumns={handleAddMultipleColumns}
          onClose={() => setShowMultiColumnModal(false)}
        />
      )}
    </div>
  );
}

// Right panel - Configuration & Version History
interface ConfigPanelProps {
  sheet: LitReviewSheet;
  onApplyPreset: (preset: LitReviewPreset) => void;
  onSaveVersion: () => void;
  onPreviewVersion: (versionId: string) => void;
  onExitPreview: () => void;
  isPreview: boolean;
  previewVersionId: string | null;
  selectedColumn: LitReviewColumn | null;
  selectedRow: LitReviewRow | null;
  selectedCell: LitReviewCell | null;
  onOverrideValue: (value: LitReviewCell['value']) => void;
  onExportExcel: () => void;
  onExportCSV: () => void;
}

function ConfigPanel({
  sheet,
  onApplyPreset,
  onSaveVersion,
  onPreviewVersion,
  onExitPreview,
  isPreview,
  previewVersionId,
  selectedColumn,
  selectedRow,
  selectedCell,
  onOverrideValue,
  onExportExcel,
  onExportCSV,
}: ConfigPanelProps) {
  const [showPresets, setShowPresets] = useState(true);
  const [showVersions, setShowVersions] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [overrideValue, setOverrideValue] = useState('');

  useEffect(() => {
    if (!selectedCell) {
      setOverrideValue('');
      return;
    }
    const val = selectedCell.value;
    if (Array.isArray(val)) {
      setOverrideValue(val.join(', '));
    } else if (val !== null && val !== undefined) {
      setOverrideValue(String(val));
    } else {
      setOverrideValue('');
    }
  }, [selectedCell]);

  const handleSaveOverride = () => {
    if (!selectedColumn) return;
    let newValue: LitReviewCell['value'] = overrideValue;

    if (selectedColumn.type === 'number') {
      const num = parseFloat(overrideValue);
      newValue = isNaN(num) ? null : num;
    } else if (selectedColumn.type === 'boolean') {
      newValue = overrideValue.toLowerCase() === 'yes' || overrideValue.toLowerCase() === 'true' || overrideValue === '1';
    } else if (selectedColumn.type === 'multiselect') {
      newValue = overrideValue.split(',').map(s => s.trim()).filter(Boolean);
    }

    onOverrideValue(newValue);
  };

  const hasCellSelected = !!selectedColumn;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] border-l border-[var(--border-default)] overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* Cell Inspector (Figma-like) - shown when cell is selected */}
        {hasCellSelected ? (
          <div className="p-4">
            {/* Paper name - subtle header */}
            {selectedRow && (
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-3">
                {selectedRow.paperTitle.length > 50 
                  ? selectedRow.paperTitle.slice(0, 50) + '...' 
                  : selectedRow.paperTitle}
              </p>
            )}

            {/* Value section - PROMINENT (editable) */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4 mb-4 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{selectedColumn.name}</h3>
                <span className="text-[10px] px-2 py-0.5 bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded-full capitalize">
                  {selectedColumn.type}
                </span>
              </div>
              {selectedColumn.type === 'select' ? (
                <select
                  value={overrideValue}
                  onChange={(e) => setOverrideValue(e.target.value)}
                  disabled={isPreview}
                  className={`w-full px-3 py-2.5 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 ${
                    isPreview ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                >
                  <option value="">Select...</option>
                  {selectedColumn.options?.map(opt => (
                    <option key={opt.id} value={opt.label}>{opt.label}</option>
                  ))}
                </select>
              ) : selectedColumn.type === 'boolean' ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => { setOverrideValue('yes'); }}
                    disabled={isPreview}
                    className={`flex-1 px-3 py-2.5 text-sm font-medium rounded-lg border-2 transition-all ${
                      overrideValue.toLowerCase() === 'yes' || overrideValue.toLowerCase() === 'true'
                        ? 'bg-[var(--accent-green-bg)]/15 border-[var(--accent-green-bg)] text-[var(--accent-green)]'
                        : 'bg-[var(--bg-primary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                    } ${isPreview ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => { setOverrideValue('no'); }}
                    disabled={isPreview}
                    className={`flex-1 px-3 py-2.5 text-sm font-medium rounded-lg border-2 transition-all ${
                      overrideValue.toLowerCase() === 'no' || overrideValue.toLowerCase() === 'false'
                        ? 'bg-[var(--accent-red-bg)]/15 border-[var(--accent-red-bg)] text-[var(--accent-red)]'
                        : 'bg-[var(--bg-primary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                    } ${isPreview ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    No
                  </button>
                </div>
              ) : (
                <textarea
                  value={overrideValue}
                  onChange={(e) => setOverrideValue(e.target.value)}
                  placeholder={selectedColumn.type === 'multiselect' ? 'Comma separated values...' : 'Enter value...'}
                  disabled={isPreview}
                  className={`w-full min-h-[120px] px-3 py-2.5 text-sm bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 resize-none ${
                    isPreview ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                  rows={5}
                />
              )}
            </div>

            {/* Column prompt - subtle (read-only) */}
            <div className="mb-3">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Prompt</p>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {selectedColumn.description}
              </p>
            </div>

            {/* Source section - subtle (read-only) */}
            <div className="mb-4">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Source</p>
              {selectedCell?.sourceText ? (
                <p className="text-xs text-[var(--text-muted)] leading-relaxed italic">
                  "{selectedCell.sourceText}"
                </p>
              ) : (
                <p className="text-xs text-[var(--text-muted)] italic">
                  No source text captured
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSaveOverride}
                disabled={isPreview || !selectedColumn}
                className={`w-full px-4 py-2.5 text-sm font-medium bg-[var(--accent-primary)] text-[var(--bg-primary)] rounded-xl transition-colors ${
                  isPreview ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'
                }`}
              >
                Save
              </button>
              {selectedCell?.aiValue !== undefined && selectedCell?.aiValue !== selectedCell?.value && (
                <button
                  onClick={() => onOverrideValue(selectedCell.aiValue ?? null)}
                  disabled={isPreview}
                  className={`w-full px-4 py-2.5 text-sm bg-[var(--bg-card)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-xl transition-colors ${
                    isPreview ? 'opacity-60 cursor-not-allowed' : 'hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  Revert to AI value
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Default state - Sheet setup */
          <>
            {/* Header */}
            <div className="p-4 border-b border-[var(--border-default)]">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Sheet Setup</h2>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Configure columns and templates
              </p>
            </div>

            {/* Presets section */}
            <div className="border-b border-[var(--border-default)]">
              <button
                onClick={() => setShowPresets(!showPresets)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
              >
                <div className="flex items-center gap-2">
                  <Columns className="w-4 h-4 text-[var(--text-muted)]" />
                  <span>Column Presets</span>
                </div>
                {showPresets ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>

              {showPresets && (
                <div className="px-4 pb-4 space-y-2">
                  {DEFAULT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => onApplyPreset(preset)}
                      className="w-full p-3 text-left bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)]/80 rounded-lg transition-colors group"
                    >
                      <p className="text-sm text-[var(--text-primary)] font-medium">{preset.name}</p>
                      {preset.description && (
                        <p className="text-xs text-[var(--text-muted)] mt-1">{preset.description}</p>
                      )}
                      <p className="text-xs text-[var(--text-muted)] mt-2">
                        {preset.columns.length} columns
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Version History section */}
        <div className="border-b border-[var(--border-default)]">
          <button
            onClick={() => setShowVersions(!showVersions)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[var(--text-muted)]" />
              <span>Version History</span>
              {sheet.versions.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded">
                  {sheet.versions.length}
                </span>
              )}
            </div>
            {showVersions ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          {showVersions && (
            <div className="px-4 pb-4 space-y-2">
              <button
                onClick={onSaveVersion}
                disabled={isPreview}
                className={`w-full flex items-center gap-2 px-3 py-2 bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] rounded-lg text-sm hover:bg-[var(--accent-primary-muted)] transition-colors ${
                  isPreview ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                <Save className="w-4 h-4" />
                Save Current Version
              </button>
              {isPreview && (
                <button
                  onClick={onExitPreview}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg text-sm hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <X className="w-4 h-4" />
                  Exit Preview
                </button>
              )}

              {sheet.versions.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] text-center py-4">No saved versions yet</p>
              ) : (
                sheet.versions.slice().reverse().map((version) => (
                  <button
                    key={version.id}
                    onClick={() => onPreviewVersion(version.id)}
                    className={`w-full p-3 text-left rounded-lg transition-colors ${
                      previewVersionId === version.id 
                        ? 'bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/30' 
                        : 'bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-[var(--text-primary)]">{version.name}</p>
                      {previewVersionId === version.id && (
                        <span className="text-[10px] text-[var(--accent-primary)] uppercase">Preview</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-muted)]">
                      <Clock className="w-3 h-3" />
                      {version.createdAt.toLocaleDateString()} {version.createdAt.toLocaleTimeString()}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {version.columns.length} columns • {version.rows.length} rows
                    </p>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Export section */}
        <div className="border-b border-[var(--border-default)]">
          <button
            onClick={() => setShowExport(!showExport)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-[var(--text-muted)]" />
              <span>Export</span>
            </div>
            {showExport ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          {showExport && (
            <div className="px-4 pb-4 space-y-2">
              <button
                onClick={onExportExcel}
                className="w-full flex items-center gap-3 px-3 py-2.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4 text-[var(--accent-green)]" />
                <div className="text-left">
                  <p className="text-sm text-[var(--text-primary)]">Download Excel</p>
                  <p className="text-xs text-[var(--text-muted)]">.xlsx format</p>
                </div>
              </button>
              <button
                onClick={onExportCSV}
                className="w-full flex items-center gap-3 px-3 py-2.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              >
                <FileText className="w-4 h-4 text-[var(--accent-primary)]" />
                <div className="text-left">
                  <p className="text-sm text-[var(--text-primary)]">Download CSV</p>
                  <p className="text-xs text-[var(--text-muted)]">.csv format</p>
                </div>
              </button>
              <button
                onClick={() => {
                  // Copy as tab-separated for pasting into Google Sheets
                  const header = ['Paper', ...sheet.columns.map(c => c.name)].join('\t');
                  const rows = sheet.rows.map(r => {
                    const cells = sheet.columns.map(c => {
                      const cell = r.cells[c.id];
                      if (!cell || cell.value === null) return '';
                      if (Array.isArray(cell.value)) return cell.value.join(', ');
                      return String(cell.value);
                    });
                    return [r.paperTitle, ...cells].join('\t');
                  });
                  navigator.clipboard.writeText([header, ...rows].join('\n'));
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              >
                <Copy className="w-4 h-4 text-[var(--accent-purple)]" />
                <div className="text-left">
                  <p className="text-sm text-[var(--text-primary)]">Copy to Clipboard</p>
                  <p className="text-xs text-[var(--text-muted)]">Paste into Google Sheets</p>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function LitReview() {
  const navigate = useNavigate();
  const { currentProject } = useProject();

  // Data state
  const [papers, setPapers] = useState<Paper[]>([]);
  const [sheets, setSheets] = useState<LitReviewSheet[]>([]);
  const [currentSheetId, setCurrentSheetId] = useState<string | null>(null);
  const [_settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [useLocalStorage, setUseLocalStorage] = useState(false); // Fallback mode
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false); // Guard for localStorage save

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [showNewSheetModal, setShowNewSheetModal] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [showSheetMenu, setShowSheetMenu] = useState(false);
  const [stagedPaperIds, setStagedPaperIds] = useState<Set<string>>(new Set());
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelId>(() => {
    const saved = localStorage.getItem('litreview-model');
    return (saved as ModelId) || 'gpt-4o-mini';
  });

  // Persist model selection
  useEffect(() => {
    localStorage.setItem('litreview-model', selectedModel);
  }, [selectedModel]);

  // Load data
  useEffect(() => {
    async function loadData() {
      if (!currentProject) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const [loadedPapers, loadedSettings] = await Promise.all([
          getAllPapers(currentProject.id),
          getSettings(),
        ]);

        setPapers(loadedPapers);
        setSettings(loadedSettings);

        // Try to load sheets from Supabase first
        try {
          const loadedSheets = await getLitReviewSheets(currentProject.id);
          setSheets(loadedSheets);
          setUseLocalStorage(false);
          if (loadedSheets.length > 0 && !currentSheetId) {
            setCurrentSheetId(loadedSheets[0].id);
          }
        } catch (sheetsError) {
          // Fallback to localStorage if Supabase tables don't exist
          console.warn('Using localStorage fallback. Run the SQL migration in Supabase for persistence.', sheetsError);
          setUseLocalStorage(true);
          const localSheets = loadSheetsFromStorage(currentProject.id);
          setSheets(localSheets);
          if (localSheets.length > 0 && !currentSheetId) {
            setCurrentSheetId(localSheets[0].id);
          }
        }
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setIsLoading(false);
        setHasInitiallyLoaded(true); // Mark as loaded to enable saving
      }
    }

    loadData();
  }, [currentProject]);

  // Save to localStorage when in fallback mode (only after initial load)
  useEffect(() => {
    // Guard: Don't save until we've finished the initial load
    // This prevents overwriting localStorage with empty state on mount
    if (hasInitiallyLoaded && useLocalStorage && currentProject) {
      saveSheetsToStorage(currentProject.id, sheets);
    }
  }, [sheets, currentProject, useLocalStorage, hasInitiallyLoaded]);

  // Computed values
  const currentSheet = useMemo(() => 
    sheets.find(s => s.id === currentSheetId), 
    [sheets, currentSheetId]
  );

  const previewVersion = useMemo(() => {
    if (!currentSheet || !previewVersionId) return null;
    return currentSheet.versions.find(v => v.id === previewVersionId) || null;
  }, [currentSheet, previewVersionId]);

  const displaySheet = useMemo(() => {
    if (!currentSheet) return null;
    if (!previewVersion) return currentSheet;
    return {
      ...currentSheet,
      columns: previewVersion.columns,
      rows: previewVersion.rows,
      selectedPaperIds: previewVersion.rows.map(r => r.paperId),
      currentVersionId: previewVersion.id,
    };
  }, [currentSheet, previewVersion]);

  const isPreviewMode = Boolean(previewVersion);

  const selectedRow = useMemo(() => {
    if (!displaySheet || !selectedCell) return null;
    return displaySheet.rows.find(r => r.id === selectedCell.rowId) || null;
  }, [displaySheet, selectedCell]);

  const selectedColumn = useMemo(() => {
    if (!displaySheet || !selectedCell) return null;
    return displaySheet.columns.find(c => c.id === selectedCell.columnId) || null;
  }, [displaySheet, selectedCell]);

  const selectedCellData = useMemo(() => {
    if (!selectedRow || !selectedColumn) return null;
    return selectedRow.cells[selectedColumn.id] || null;
  }, [selectedRow, selectedColumn]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    papers.forEach(p => p.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [papers]);

  const inSheetPaperIds = useMemo(() => 
    new Set(displaySheet?.selectedPaperIds || []),
    [displaySheet]
  );

  useEffect(() => {
    if (previewVersionId && !previewVersion) {
      setPreviewVersionId(null);
    }
  }, [previewVersionId, previewVersion]);

  // Handlers
  
  // Toggle paper in staging area
  const handleToggleStaged = (paperId: string) => {
    setStagedPaperIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(paperId)) {
        newSet.delete(paperId);
      } else {
        newSet.add(paperId);
      }
      return newSet;
    });
  };

  // Stage all visible papers (that aren't already in sheet)
  const handleStageAll = () => {
    const filteredPapers = papers.filter(p => {
      const matchesSearch = !searchQuery || 
        p.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTag = !filterTag || p.tags.includes(filterTag);
      const notInSheet = !inSheetPaperIds.has(p.id);
      return matchesSearch && matchesTag && notInSheet;
    });
    setStagedPaperIds(new Set(filteredPapers.map(p => p.id)));
  };

  // Clear staging area
  const handleClearStaged = () => {
    setStagedPaperIds(new Set());
  };

  // Confirm and add staged papers to sheet
  const handleConfirmAddPapers = async () => {
    if (!currentSheet || stagedPaperIds.size === 0) return;

    const papersToAdd = papers.filter(p => stagedPaperIds.has(p.id));
    const newSelectedIds = [...currentSheet.selectedPaperIds, ...papersToAdd.map(p => p.id)];
    
    const newRows = [...currentSheet.rows];
    const rowsToAdd: LitReviewRow[] = [];
    
    papersToAdd.forEach(paper => {
      const newRow: LitReviewRow = {
        id: uuidv4(),
        paperId: paper.id,
        paperTitle: paper.title,
        cells: {},
        status: 'pending',
      };
      newRows.push(newRow);
      rowsToAdd.push(newRow);
    });

    // Add rows to database (skip if using localStorage)
    if (!useLocalStorage && rowsToAdd.length > 0) {
      try {
        await Promise.all(rowsToAdd.map(row => upsertLitReviewRow(currentSheet.id, row)));
      } catch (error) {
        console.error('Error adding rows:', error);
      }
    }

    handleUpdateSheet({
      ...currentSheet,
      selectedPaperIds: newSelectedIds,
      rows: newRows,
    });

    // Clear staging area
    setStagedPaperIds(new Set());
  };

  // Remove a row from the sheet
  const handleRemoveRow = async (rowId: string) => {
    if (!currentSheet) return;

    const rowToRemove = currentSheet.rows.find(r => r.id === rowId);
    if (!rowToRemove) return;

    const newSelectedIds = currentSheet.selectedPaperIds.filter(id => id !== rowToRemove.paperId);
    const newRows = currentSheet.rows.filter(r => r.id !== rowId);

    // Delete from database (skip if using localStorage)
    if (!useLocalStorage) {
      try {
        await deleteLitReviewRowByPaper(currentSheet.id, rowToRemove.paperId);
      } catch (error) {
        console.error('Error removing row:', error);
      }
    }

    handleUpdateSheet({
      ...currentSheet,
      selectedPaperIds: newSelectedIds,
      rows: newRows,
    });
  };
  const handleCreateSheet = async () => {
    if (!currentProject || !newSheetName.trim()) return;

    if (useLocalStorage) {
      // localStorage fallback
      const newSheet: LitReviewSheet = {
        id: uuidv4(),
        projectId: currentProject.id,
        name: newSheetName.trim(),
        columns: [],
        rows: [],
        versions: [],
        selectedPaperIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setSheets([newSheet, ...sheets]);
      setCurrentSheetId(newSheet.id);
      setShowNewSheetModal(false);
      setNewSheetName('');
    } else {
      try {
        const newSheet = await createLitReviewSheet(currentProject.id, newSheetName.trim());
        setSheets([newSheet, ...sheets]);
        setCurrentSheetId(newSheet.id);
        setShowNewSheetModal(false);
        setNewSheetName('');
      } catch (error) {
        console.error('Error creating sheet:', error);
        alert('Failed to create sheet. Please try again.');
      }
    }
  };

  const handleDeleteSheet = async (sheetId: string) => {
    const newSheets = sheets.filter(s => s.id !== sheetId);
    setSheets(newSheets);
    if (currentSheetId === sheetId) {
      setCurrentSheetId(newSheets.length > 0 ? newSheets[0].id : null);
    }
    
    if (!useLocalStorage) {
      try {
        await deleteLitReviewSheet(sheetId);
      } catch (error) {
        console.error('Error deleting sheet from database:', error);
      }
    }
  };

  const handleUpdateSheet = useCallback(async (updatedSheet: LitReviewSheet) => {
    const sheetWithTimestamp = { ...updatedSheet, updatedAt: new Date() };
    setSheets(prev => prev.map(s => s.id === updatedSheet.id ? sheetWithTimestamp : s));
    
    // Save to database if not using localStorage fallback
    if (!useLocalStorage) {
      try {
        await updateLitReviewSheet(sheetWithTimestamp);
      } catch (error) {
        console.error('Error saving sheet:', error);
      }
    }
  }, [useLocalStorage]);

  const handleApplyPreset = (preset: LitReviewPreset) => {
    if (!currentSheet) return;
    handleUpdateSheet({
      ...currentSheet,
      columns: preset.columns.map(c => ({ ...c, id: uuidv4() })),
      // Reset cells since columns changed
      rows: currentSheet.rows.map(r => ({ ...r, cells: {}, status: 'pending' as const })),
    });
  };

  const handleRunExtraction = async (rowIds?: string[], forceRefresh = false) => {
    if (!currentSheet) {
      return;
    }

    if (currentSheet.columns.length === 0) {
      alert('Please add at least one column first');
      return;
    }

    setIsExtracting(true);

    // If specific rowIds are passed, process those (force refresh)
    // Otherwise, only process rows that are pending or have errors (skip completed)
    const rowsToProcess = rowIds 
      ? currentSheet.rows.filter(r => rowIds.includes(r.id))
      : forceRefresh
        ? currentSheet.rows
        : currentSheet.rows.filter(r => r.status !== 'completed');

    if (rowsToProcess.length === 0) {
      alert('All rows are already completed. Use the refresh button on individual rows to re-extract.');
      setIsExtracting(false);
      return;
    }

    // Mark rows as processing
    handleUpdateSheet({
      ...currentSheet,
      rows: currentSheet.rows.map(r => 
        rowsToProcess.some(rtp => rtp.id === r.id)
          ? { ...r, status: 'processing' as const }
          : r
      ),
    });

    // Process each row
    for (const row of rowsToProcess) {
      try {
        // Get paper PDF text
        const paperFile = await getPaperFile(row.paperId);
        if (!paperFile) {
          throw new Error('PDF not found');
        }

        const paperText = await extractTextFromPDF(paperFile.data);

        // Extract each column using selected model
        const cells: Record<string, LitReviewCell> = {};
        for (const column of currentSheet.columns) {
          const cell = await extractColumnValue(paperText, column, selectedModel);
          cells[column.id] = { ...cell, status: undefined, aiValue: cell.value };
        }

        // Update row
        const updatedRow: LitReviewRow = { ...row, cells, status: 'completed' as const, extractedAt: new Date() };
        
        // Save to database (skip if using localStorage)
        if (!useLocalStorage) {
          try {
            await upsertLitReviewRow(currentSheet.id, updatedRow);
          } catch (dbError) {
            console.error('Error saving row to database:', dbError);
          }
        }
        
        setSheets(prev => prev.map(s => {
          if (s.id !== currentSheet.id) return s;
          return {
            ...s,
            rows: s.rows.map(r => r.id === row.id ? updatedRow : r),
            updatedAt: new Date(),
          };
        }));
      } catch (error) {
        console.error('Extraction error for row:', row.id, error);
        const errorRow: LitReviewRow = { ...row, status: 'error' as const, errorMessage: String(error) };
        
        // Save error state to database (skip if using localStorage)
        if (!useLocalStorage) {
          try {
            await upsertLitReviewRow(currentSheet.id, errorRow);
          } catch (dbError) {
            console.error('Error saving error row to database:', dbError);
          }
        }
        
        setSheets(prev => prev.map(s => {
          if (s.id !== currentSheet.id) return s;
          return {
            ...s,
            rows: s.rows.map(r => r.id === row.id ? errorRow : r),
            updatedAt: new Date(),
          };
        }));
      }
    }

    setIsExtracting(false);
  };

  const handleRunColumnExtraction = async (columnId: string) => {
    if (!currentSheet) return;
    const column = currentSheet.columns.find(c => c.id === columnId);
    if (!column) return;

    setIsExtracting(true);

    // Mark target cells as processing
    setSheets(prev => prev.map(s => {
      if (s.id !== currentSheet.id) return s;
      return {
        ...s,
        rows: s.rows.map(r => ({
          ...r,
          cells: {
            ...r.cells,
            [columnId]: {
              value: r.cells[columnId]?.value ?? null,
              confidence: r.cells[columnId]?.confidence,
              sourceText: r.cells[columnId]?.sourceText,
              status: 'processing',
            },
          },
        })),
        updatedAt: new Date(),
      };
    }));

    for (const row of currentSheet.rows) {
      try {
        const paperFile = await getPaperFile(row.paperId);
        if (!paperFile) {
          throw new Error('PDF not found');
        }

        const paperText = await extractTextFromPDF(paperFile.data);
        const cell = await extractColumnValue(paperText, column, selectedModel);
        const updatedRow: LitReviewRow = {
          ...row,
          cells: {
            ...row.cells,
            [columnId]: { ...cell, status: undefined, aiValue: cell.value },
          },
        };

        if (!useLocalStorage) {
          try {
            await upsertLitReviewRow(currentSheet.id, updatedRow);
          } catch (dbError) {
            console.error('Error saving row to database:', dbError);
          }
        }

        setSheets(prev => prev.map(s => {
          if (s.id !== currentSheet.id) return s;
          return {
            ...s,
            rows: s.rows.map(r => r.id === row.id ? updatedRow : r),
            updatedAt: new Date(),
          };
        }));
      } catch (error) {
        console.error('Column extraction error for row:', row.id, error);
        const errorRow: LitReviewRow = {
          ...row,
          cells: {
            ...row.cells,
            [columnId]: {
              value: row.cells[columnId]?.value ?? null,
              confidence: row.cells[columnId]?.confidence,
              sourceText: row.cells[columnId]?.sourceText,
              status: 'error',
            },
          },
        };

        if (!useLocalStorage) {
          try {
            await upsertLitReviewRow(currentSheet.id, errorRow);
          } catch (dbError) {
            console.error('Error saving error row to database:', dbError);
          }
        }

        setSheets(prev => prev.map(s => {
          if (s.id !== currentSheet.id) return s;
          return {
            ...s,
            rows: s.rows.map(r => r.id === row.id ? errorRow : r),
            updatedAt: new Date(),
          };
        }));
      }
    }

    setIsExtracting(false);
  };

  const handleSaveVersion = async () => {
    if (!currentSheet || isPreviewMode) return;

    const versionName = `Version ${currentSheet.versions.length + 1}`;
    const version: LitReviewVersion = {
      id: uuidv4(),
      name: versionName,
      createdAt: new Date(),
      columns: [...currentSheet.columns],
      rows: currentSheet.rows.map(r => ({ ...r })),
    };

    // Save to database if not using localStorage
    if (!useLocalStorage) {
      try {
        await saveLitReviewVersion(currentSheet.id, version);
      } catch (error) {
        console.error('Error saving version to database:', error);
      }
    }

    handleUpdateSheet({
      ...currentSheet,
      versions: [...currentSheet.versions, version],
      currentVersionId: version.id,
    });
  };

  const handlePreviewVersion = (versionId: string) => {
    if (!currentSheet) return;
    setPreviewVersionId(versionId);
  };

  const handleExitPreview = () => {
    setPreviewVersionId(null);
  };

  const handleOverrideValue = (value: LitReviewCell['value']) => {
    if (!currentSheet || !selectedCell || !selectedColumn) return;
    if (isPreviewMode) return;

    handleUpdateSheet({
      ...currentSheet,
      rows: currentSheet.rows.map(r => {
        if (r.id !== selectedCell.rowId) return r;
        const existingCell = r.cells[selectedCell.columnId];
        const aiValue = existingCell?.aiValue ?? existingCell?.value ?? null;
        return {
          ...r,
          cells: {
            ...r.cells,
            [selectedCell.columnId]: {
              ...existingCell,
              value,
              confidence: undefined,
              aiValue,
            },
          },
        };
      }),
    });
  };

  const handleExportExcel = () => {
    if (!currentSheet) return;
    
    // Create CSV and trigger download (basic implementation - for full Excel, need xlsx library)
    const header = ['Paper', ...currentSheet.columns.map(c => c.name)].join(',');
    const rows = currentSheet.rows.map(r => {
      const cells = currentSheet.columns.map(c => {
        const cell = r.cells[c.id];
        if (!cell || cell.value === null) return '';
        if (Array.isArray(cell.value)) return `"${cell.value.join(', ')}"`;
        const val = String(cell.value);
        return val.includes(',') ? `"${val}"` : val;
      });
      const title = r.paperTitle.includes(',') ? `"${r.paperTitle}"` : r.paperTitle;
      return [title, ...cells].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSheet.name}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    if (!currentSheet) return;

    const header = ['Paper', ...currentSheet.columns.map(c => c.name)].join(',');
    const rows = currentSheet.rows.map(r => {
      const cells = currentSheet.columns.map(c => {
        const cell = r.cells[c.id];
        if (!cell || cell.value === null) return '';
        if (Array.isArray(cell.value)) return `"${cell.value.join(', ')}"`;
        const val = String(cell.value);
        return val.includes(',') ? `"${val}"` : val;
      });
      const title = r.paperTitle.includes(',') ? `"${r.paperTitle}"` : r.paperTitle;
      return [title, ...cells].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSheet.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-[var(--accent-primary)] animate-spin" />
          <p className="text-[var(--text-secondary)]">Loading literature review...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[var(--bg-primary)] flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-default)]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">Literature Review</h1>
            <p className="text-xs text-[var(--text-muted)]">{currentProject?.name}</p>
          </div>
        </div>

        {/* Sheet tabs */}
        <div className="flex items-center gap-2">
          {sheets.map((sheet) => (
            <div
              key={sheet.id}
              onClick={() => {
                setCurrentSheetId(sheet.id);
                setPreviewVersionId(null);
              }}
              className={`relative flex items-center px-4 py-2 text-sm rounded-lg transition-all cursor-pointer ${
                currentSheetId === sheet.id
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {sheet.name}
              {currentSheetId === sheet.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSheetMenu(!showSheetMenu);
                  }}
                  className="ml-2 p-0.5 hover:bg-[var(--bg-tertiary)] rounded"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => setShowNewSheetModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Sheet
          </button>
        </div>

        <div className="w-24" /> {/* Spacer for balance */}
      </header>

      {/* Main content */}
      {currentSheet ? (
        <div className="flex-1 flex overflow-hidden min-w-0">
          {/* Left panel - Papers */}
          <div className="w-72 flex-shrink-0">
            <PaperListPanel
              papers={papers}
              inSheetPaperIds={inSheetPaperIds}
              stagedPaperIds={stagedPaperIds}
              isPreview={isPreviewMode}
              onToggleStaged={handleToggleStaged}
              onStageAll={handleStageAll}
              onClearStaged={handleClearStaged}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filterTag={filterTag}
              onFilterTagChange={setFilterTag}
              allTags={allTags}
            />
          </div>

          {/* Center - Spreadsheet */}
          <Spreadsheet
            sheet={displaySheet || currentSheet}
            papers={papers}
            onUpdateSheet={handleUpdateSheet}
            onRunExtraction={handleRunExtraction}
            onRunColumnExtraction={handleRunColumnExtraction}
            onRemoveRow={handleRemoveRow}
            isExtracting={isExtracting}
            isPreview={isPreviewMode}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            onSelectCell={setSelectedCell}
          />

          {/* Right panel - Config */}
          <div className="w-72 flex-shrink-0">
            <ConfigPanel
              sheet={currentSheet}
              onApplyPreset={handleApplyPreset}
              onSaveVersion={handleSaveVersion}
              onPreviewVersion={handlePreviewVersion}
              onExitPreview={handleExitPreview}
              isPreview={isPreviewMode}
              previewVersionId={previewVersionId}
              selectedColumn={selectedColumn}
              selectedRow={selectedRow}
              selectedCell={selectedCellData}
              onOverrideValue={handleOverrideValue}
              onExportExcel={handleExportExcel}
              onExportCSV={handleExportCSV}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center">
          <FileSpreadsheet className="w-16 h-16 text-[var(--text-muted)] mb-6" />
          <h2 className="text-xl font-medium text-[var(--text-primary)] mb-2">No sheets yet</h2>
          <p className="text-[var(--text-muted)] mb-6 text-center max-w-md">
            Create a literature review sheet to start extracting structured data from your papers using AI.
          </p>
          <button
            onClick={() => setShowNewSheetModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create First Sheet
          </button>
        </div>
      )}

      {/* Sheet menu dropdown */}
      {showSheetMenu && currentSheet && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSheetMenu(false)} />
          <div className="fixed top-14 right-1/2 translate-x-1/2 bg-[#252529] border border-[var(--border-default)] rounded-lg shadow-xl z-50 py-1 min-w-[160px]">
            <button
              onClick={() => {
                const newName = prompt('Rename sheet:', currentSheet.name);
                if (newName) {
                  handleUpdateSheet({ ...currentSheet, name: newName.trim() });
                }
                setShowSheetMenu(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            >
              <FileText className="w-4 h-4" />
              Rename
            </button>
            <button
              onClick={() => {
                // Duplicate sheet
                const duplicated: LitReviewSheet = {
                  ...currentSheet,
                  id: uuidv4(),
                  name: `${currentSheet.name} (copy)`,
                  versions: [],
                  currentVersionId: undefined,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                };
                setSheets([...sheets, duplicated]);
                setCurrentSheetId(duplicated.id);
                setShowSheetMenu(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
            <div className="border-t border-[var(--border-default)] my-1" />
            <button
              onClick={() => {
                if (confirm('Delete this sheet? This cannot be undone.')) {
                  handleDeleteSheet(currentSheet.id);
                }
                setShowSheetMenu(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]/10"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </>
      )}

      {/* New sheet modal */}
      {showNewSheetModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)]">
              <h3 className="text-lg font-medium text-[var(--text-primary)]">Create New Sheet</h3>
              <button
                onClick={() => { setShowNewSheetModal(false); setNewSheetName(''); }}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5">
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Sheet Name</label>
              <input
                type="text"
                value={newSheetName}
                onChange={(e) => setNewSheetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSheetName.trim()) {
                    handleCreateSheet();
                  }
                }}
                placeholder="e.g., HCI Studies 2024"
                autoFocus
                className="w-full px-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30"
              />
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--border-default)]">
              <button
                onClick={() => { setShowNewSheetModal(false); setNewSheetName(''); }}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleCreateSheet()}
                disabled={!newSheetName.trim()}
                className="px-5 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Create Sheet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom confirmation bar for staged papers */}
      {!isPreviewMode && stagedPaperIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 animate-in slide-in-from-bottom duration-200">
          <div className="bg-[var(--bg-card)] border-t border-[var(--border-default)] shadow-2xl">
            <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-[var(--accent-primary)]/20 flex items-center justify-center">
                    <span className="text-sm font-medium text-[var(--accent-primary)]">{stagedPaperIds.size}</span>
                  </div>
                  <span className="text-sm text-[var(--text-primary)]">
                    paper{stagedPaperIds.size !== 1 ? 's' : ''} selected
                  </span>
                </div>
                <div className="h-4 w-px bg-[var(--bg-tertiary)]" />
                <div className="flex -space-x-1">
                  {Array.from(stagedPaperIds).slice(0, 3).map(id => {
                    const paper = papers.find(p => p.id === id);
                    return (
                      <div
                        key={id}
                        className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] border-2 border-[#1e1e22] flex items-center justify-center"
                        title={paper?.title}
                      >
                        <FileText className="w-3 h-3 text-[var(--text-muted)]" />
                      </div>
                    );
                  })}
                  {stagedPaperIds.size > 3 && (
                    <div className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] border-2 border-[#1e1e22] flex items-center justify-center">
                      <span className="text-[10px] text-[var(--text-muted)]">+{stagedPaperIds.size - 3}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleClearStaged}
                  className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmAddPapers}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add to Sheet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LitReview;
