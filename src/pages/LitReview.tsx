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
  column: LitReviewColumn
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
    ], { temperature: 0.1 });

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
  selectedPaperIds: Set<string>;
  onTogglePaper: (paperId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterTag: string | null;
  onFilterTagChange: (tag: string | null) => void;
  allTags: string[];
}

function PaperListPanel({
  papers,
  selectedPaperIds,
  onTogglePaper,
  onSelectAll,
  onDeselectAll,
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

  const selectedCount = selectedPaperIds.size;
  const filteredCount = filteredPapers.length;

  return (
    <div className="flex flex-col h-full bg-[#1a1a1e] border-r border-white/10">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <h2 className="text-sm font-semibold text-white/90 mb-3">Papers</h2>
        
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search papers..."
            className="w-full pl-10 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
        </div>

        {/* Filter */}
        <div className="relative">
          <button
            onClick={() => setShowTagFilter(!showTagFilter)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              filterTag ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            {filterTag || 'Filter by tag'}
            <ChevronDown className="w-3 h-3" />
          </button>

          {showTagFilter && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-[#252529] border border-white/10 rounded-lg shadow-xl z-10 py-1 max-h-48 overflow-y-auto">
              <button
                onClick={() => { onFilterTagChange(null); setShowTagFilter(false); }}
                className="w-full px-3 py-1.5 text-left text-xs text-white/60 hover:bg-white/10"
              >
                All papers
              </button>
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => { onFilterTagChange(tag); setShowTagFilter(false); }}
                  className={`w-full px-3 py-1.5 text-left text-xs hover:bg-white/10 ${
                    filterTag === tag ? 'text-blue-400' : 'text-white/80'
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
      <div className="flex items-center justify-between px-4 py-2 bg-white/[0.02] border-b border-white/10">
        <span className="text-xs text-white/50">
          {selectedCount} of {filteredCount} selected
        </span>
        <div className="flex gap-2">
          <button
            onClick={onSelectAll}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            All
          </button>
          <button
            onClick={onDeselectAll}
            className="text-xs text-white/50 hover:text-white/70"
          >
            None
          </button>
        </div>
      </div>

      {/* Paper list */}
      <div className="flex-1 overflow-y-auto">
        {filteredPapers.map((paper) => {
          const isSelected = selectedPaperIds.has(paper.id);
          return (
            <div
              key={paper.id}
              onClick={() => onTogglePaper(paper.id)}
              className={`flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-white/5 transition-colors ${
                isSelected ? 'bg-blue-500/10' : 'hover:bg-white/5'
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                isSelected ? 'bg-blue-500 border-blue-500' : 'border-white/30'
              }`}>
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/90 line-clamp-2 leading-snug">
                  {paper.title}
                </p>
                {paper.authors && (
                  <p className="text-xs text-white/40 mt-1 truncate">
                    {paper.authors}
                  </p>
                )}
                {paper.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {paper.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="px-1.5 py-0.5 text-[10px] bg-white/10 text-white/50 rounded">
                        {tag}
                      </span>
                    ))}
                    {paper.tags.length > 2 && (
                      <span className="text-[10px] text-white/40">+{paper.tags.length - 2}</span>
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
      <div className="bg-[#1e1e22] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h3 className="text-lg font-medium text-white">Configure Column</h3>
          <button onClick={onClose} className="p-1 text-white/50 hover:text-white/80">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-white/60 mb-2">Column Name</label>
            <input
              type="text"
              value={localColumn.name}
              onChange={(e) => setLocalColumn({ ...localColumn, name: e.target.value })}
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-white/60 mb-2">Data Type</label>
            <select
              value={localColumn.type}
              onChange={(e) => setLocalColumn({ 
                ...localColumn, 
                type: e.target.value as LitReviewColumnType,
                options: ['select', 'multiselect'].includes(e.target.value) ? localColumn.options || [] : undefined,
              })}
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            >
              {typeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Description / AI Prompt */}
          <div>
            <label className="block text-xs font-medium text-white/60 mb-2">
              Extraction Prompt
              <span className="text-white/40 font-normal ml-1">(What should AI look for?)</span>
            </label>
            <textarea
              value={localColumn.description}
              onChange={(e) => setLocalColumn({ ...localColumn, description: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              placeholder="e.g., What type of study was conducted? Look for methodology section."
            />
          </div>

          {/* Options for select/multiselect */}
          {(localColumn.type === 'select' || localColumn.type === 'multiselect') && (
            <div>
              <label className="block text-xs font-medium text-white/60 mb-2">Options</label>
              <div className="space-y-2">
                {localColumn.options?.map((opt) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: opt.color }}
                    />
                    <span className="flex-1 text-sm text-white/80">{opt.label}</span>
                    <button
                      onClick={() => handleRemoveOption(opt.id)}
                      className="p-1 text-white/40 hover:text-red-400"
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
                    className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  />
                  <button
                    onClick={handleAddOption}
                    className="px-3 py-1.5 bg-white/10 text-white/80 rounded-lg text-sm hover:bg-white/20"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Width */}
          <div>
            <label className="block text-xs font-medium text-white/60 mb-2">Column Width</label>
            <input
              type="number"
              value={localColumn.width}
              onChange={(e) => setLocalColumn({ ...localColumn, width: parseInt(e.target.value) || 150 })}
              min={80}
              max={500}
              className="w-24 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
            <span className="ml-2 text-xs text-white/40">px</span>
          </div>
        </div>

        <div className="flex items-center justify-between p-5 border-t border-white/10">
          <button
            onClick={onDelete}
            className="px-4 py-2 text-sm text-red-400 hover:text-red-300"
          >
            Delete Column
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-white/60 hover:text-white/80"
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

// Helper to call OpenAI (uses server-side in production, falls back to client-side in dev)
async function callOpenAIWithFallback(
  messages: { role: string; content: string }[],
  options: { model?: string; temperature?: number; max_tokens?: number } = {}
): Promise<{ choices: { message: { content: string } }[] }> {
  const { model = 'gpt-4o-mini', temperature = 0.3, max_tokens = 1000 } = options;
  
  // Try server-side API first
  try {
    const response = await fetch('/api/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model, temperature, max_tokens }),
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
    body: JSON.stringify({ model, messages, temperature, max_tokens }),
  });
  
  if (!response.ok) {
    throw new Error('OpenAI API request failed');
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
    const columnNames = quickText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (columnNames.length === 0) {
      alert('Please enter at least one column name');
      return;
    }

    setIsGenerating(true);
    try {
      // Generate prompts for all columns (AI will infer types)
      const prompts = await generateColumnPrompts(
        columnNames.map(name => ({ name, type: 'text' as LitReviewColumnType }))
      );

      // Create columns with generated prompts
      const newColumns: LitReviewColumn[] = columnNames.map((name, i) => ({
        id: uuidv4(),
        name,
        type: 'text' as LitReviewColumnType,
        description: prompts[i] || '',
        width: 150,
      }));

      onAddColumns(newColumns);
      onClose();
    } catch (error) {
      console.error('Failed to generate prompts:', error);
      alert('Failed to generate prompts. Please try again.');
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
      <div className="bg-[#1e1e22] border border-white/10 rounded-2xl w-full max-w-3xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col my-8">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h3 className="text-lg font-medium text-white">Add Multiple Columns</h3>
            <p className="text-sm text-white/50 mt-1">Define columns and let AI generate extraction prompts</p>
          </div>
          <button onClick={onClose} className="p-1 text-white/50 hover:text-white/80">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-1 p-2 mx-5 mt-5 bg-white/5 rounded-lg w-fit">
          <button
            onClick={() => setMode('quick')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              mode === 'quick' 
                ? 'bg-white/10 text-white' 
                : 'text-white/50 hover:text-white/70'
            }`}
          >
            Quick
          </button>
          <button
            onClick={() => setMode('detailed')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              mode === 'detailed' 
                ? 'bg-white/10 text-white' 
                : 'text-white/50 hover:text-white/70'
            }`}
          >
            Detailed
          </button>
        </div>

        {mode === 'quick' ? (
          /* Quick Mode - Plain text entry */
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm text-white/70 mb-2">
                Enter column names (one per line)
              </label>
              <textarea
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                placeholder={`Study Type\nSample Size\nKey Findings\nLimitations\n...`}
                rows={10}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-none font-mono"
              />
              <p className="text-xs text-white/40 mt-2">
                {quickColumnCount} column{quickColumnCount !== 1 ? 's' : ''} • AI will automatically generate extraction prompts
              </p>
            </div>
          </div>
        ) : (
          /* Detailed Mode - Individual column configuration */
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {columns.map((column, index) => (
            <div
              key={column.id}
              className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3"
            >
              <div className="flex items-start justify-between">
                <span className="text-xs font-medium text-white/40">Column {index + 1}</span>
                {columns.length > 1 && (
                  <button
                    onClick={() => removeColumn(column.id)}
                    className="p-1 text-white/30 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Name */}
                <div>
                  <label className="block text-xs text-white/50 mb-1">Name</label>
                  <input
                    type="text"
                    value={column.name}
                    onChange={(e) => updateColumn(column.id, { name: e.target.value })}
                    placeholder="e.g., Study Type"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  />
                </div>

                {/* Type */}
                <div>
                  <label className="block text-xs text-white/50 mb-1">Type</label>
                  <select
                    value={column.type}
                    onChange={(e) => updateColumn(column.id, { 
                      type: e.target.value as LitReviewColumnType,
                      options: ['select', 'multiselect'].includes(e.target.value) ? column.options : [],
                      optionsText: ['select', 'multiselect'].includes(e.target.value) ? column.optionsText : '',
                    })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
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
                  <label className="block text-xs text-white/50 mb-1">Options (comma-separated)</label>
                  <input
                    type="text"
                    value={column.optionsText}
                    onChange={(e) => updateColumn(column.id, { 
                      optionsText: e.target.value,
                      options: e.target.value.split(',').map(o => o.trim()).filter(o => o),
                    })}
                    placeholder="e.g., Qualitative, Quantitative, Mixed"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  />
                </div>
              )}

              {/* AI Generated Prompt */}
              {promptsGenerated && column.prompt && (
                <div>
                  <label className="block text-xs text-white/50 mb-1">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-purple-400" />
                      AI-Generated Prompt
                    </span>
                  </label>
                  <textarea
                    value={column.prompt}
                    onChange={(e) => updateColumn(column.id, { prompt: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 bg-purple-500/10 border border-purple-500/20 rounded-lg text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-purple-500/50 resize-none"
                  />
                </div>
              )}
            </div>
          ))}

          {/* Add Column Button */}
          <button
            onClick={addColumn}
            className="w-full py-3 border-2 border-dashed border-white/10 rounded-xl text-white/50 hover:text-white/70 hover:border-white/20 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Another Column
          </button>
        </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-white/10 bg-[#1a1a1e]">
          {mode === 'detailed' && (
            <button
              onClick={handleGeneratePrompts}
              disabled={isGenerating || columns.every(c => !c.name.trim())}
              className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 text-purple-300 rounded-lg hover:bg-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="px-4 py-2 text-sm text-white/60 hover:text-white/80 disabled:opacity-50"
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
  status: LitReviewRow['status'];
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onUpdateValue: (value: LitReviewCell['value']) => void;
  onNavigate: (direction: 'up' | 'down' | 'left' | 'right') => void;
}

function EditableCell({ 
  cell, 
  column, 
  status, 
  isSelected, 
  isEditing,
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
      // Navigation when selected but not editing
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        onStartEdit();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onNavigate('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onNavigate('down');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onNavigate('left');
      } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault();
        onNavigate('right');
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
  if (status === 'processing') {
    return (
      <div className="flex items-center justify-center h-full min-h-[40px]">
        <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-red-400 text-xs min-h-[40px]">
        <AlertCircle className="w-3.5 h-3.5" />
        Error
      </div>
    );
  }

  const value = cell?.value;
  const confidence = cell?.confidence;
  const confidenceColor = confidence && confidence >= 0.8 ? 'text-green-400' : 
                         confidence && confidence >= 0.5 ? 'text-yellow-400' : 'text-red-400';

  // Editing mode
  if (isEditing) {
    if (column.type === 'boolean') {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={editValue.toLowerCase() === 'yes' || editValue.toLowerCase() === 'true' || editValue === '1' ? 'yes' : 'no'}
          onChange={(e) => {
            onUpdateValue(e.target.value === 'yes');
            onEndEdit();
          }}
          onBlur={onEndEdit}
          onKeyDown={handleInputKeyDown}
          className="w-full h-full bg-[#2a2a2e] border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
    }

    if (column.type === 'select') {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={editValue}
          onChange={(e) => {
            onUpdateValue(e.target.value);
            onEndEdit();
          }}
          onBlur={onEndEdit}
          onKeyDown={handleInputKeyDown}
          className="w-full h-full bg-[#2a2a2e] border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
        >
          <option value="">Select...</option>
          {column.options?.map(opt => (
            <option key={opt.id} value={opt.label}>{opt.label}</option>
          ))}
        </select>
      );
    }

    // Text / Number / Multiselect - use textarea for multiline
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={saveAndClose}
        onKeyDown={handleInputKeyDown}
        placeholder={column.type === 'multiselect' ? 'Comma separated...' : 'Type here...'}
        className="w-full min-h-[60px] bg-[#2a2a2e] border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none resize-none"
        rows={3}
      />
    );
  }

  // Display mode
  const baseClasses = `min-h-[40px] w-full h-full px-2 py-2 cursor-pointer rounded transition-all ${
    isSelected 
      ? 'ring-2 ring-blue-500 bg-blue-500/10' 
      : 'hover:bg-white/5'
  }`;

  const renderValue = () => {
    if (value === null || value === undefined) {
      return <span className="text-white/30 text-xs italic">Empty - click to edit</span>;
    }

    if (column.type === 'boolean') {
      return (
        <div className="flex items-center gap-2">
          {value ? (
            <CheckCircle2 className="w-4 h-4 text-green-400" />
          ) : (
            <X className="w-4 h-4 text-white/30" />
          )}
          <span className="text-sm text-white/70">{value ? 'Yes' : 'No'}</span>
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
      return <span className="text-sm text-white/90 font-mono">{value}</span>;
    }

    // Text - no line clamp, show full content
    return <p className="text-sm text-white/80 whitespace-pre-wrap break-words">{String(value)}</p>;
  };

  return (
    <div
      className={baseClasses}
      onClick={onSelect}
      onDoubleClick={onStartEdit}
      onKeyDown={handleKeyDown}
      tabIndex={isSelected ? 0 : -1}
      role="gridcell"
    >
      <div className="relative">
        {renderValue()}
        {confidence !== undefined && (
          <span className={`text-[10px] ${confidenceColor} absolute top-0 right-0`}>
            {Math.round(confidence * 100)}%
          </span>
        )}
      </div>
      {cell?.sourceText && isSelected && (
        <div className="mt-2 p-2 bg-[#2a2a2e] border border-white/10 rounded text-xs text-white/50 italic">
          Source: "{cell.sourceText}"
        </div>
      )}
    </div>
  );
}

// Spreadsheet component
interface SpreadsheetProps {
  sheet: LitReviewSheet;
  papers: Paper[];
  onUpdateSheet: (sheet: LitReviewSheet) => void;
  onRunExtraction: (rowIds?: string[]) => void;
  isExtracting: boolean;
}

function Spreadsheet({ sheet, papers, onUpdateSheet, onRunExtraction, isExtracting }: SpreadsheetProps) {
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{ columnId: string; startX: number; startWidth: number } | null>(null);
  const [showMultiColumnModal, setShowMultiColumnModal] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
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
                } 
              } 
            } 
          : r
      ),
    });
  }, [sheet, onUpdateSheet]);

  // Handle keyboard navigation
  const handleNavigate = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
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
      }
    }
  }, [selectedCell, sheet.rows, sheet.columns]);

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

  const handleAddMultipleColumns = (newColumns: LitReviewColumn[]) => {
    onUpdateSheet({
      ...sheet,
      columns: [...sheet.columns, ...newColumns],
    });
  };

  const handleAddColumn = () => {
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
    onUpdateSheet({
      ...sheet,
      columns: sheet.columns.map(c => c.id === column.id ? column : c),
    });
  };

  const handleDeleteColumn = (columnId: string) => {
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

  const totalWidth = 280 + sheet.columns.reduce((sum, c) => sum + c.width, 0) + 50;

  return (
    <div className="flex-1 flex flex-col bg-[#161618] min-w-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 bg-[#1a1a1e] border-b border-white/10">
        <div className="flex items-center gap-3">
          <button
            onClick={handleAddColumn}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/80 text-sm rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Column
          </button>
          <button
            onClick={() => setShowMultiColumnModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 text-sm rounded-lg transition-colors"
          >
            <Columns className="w-4 h-4" />
            Add Multiple
          </button>
          <button
            onClick={() => onRunExtraction()}
            disabled={isExtracting || sheet.columns.length === 0 || sheet.selectedPaperIds.length === 0}
            className={`flex items-center gap-2 px-4 py-1.5 text-sm rounded-lg transition-all ${
              isExtracting ? 'bg-blue-500/50 text-white/70' :
              sheet.columns.length === 0 || sheet.selectedPaperIds.length === 0 
                ? 'bg-white/5 text-white/30 cursor-not-allowed'
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

        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">
            {sheet.rows.filter(r => r.status === 'completed').length} / {sheet.rows.length} rows complete
          </span>
        </div>
      </div>

      {/* Table */}
      <div ref={tableRef} className="flex-1 overflow-x-auto overflow-y-auto">
        <div style={{ minWidth: totalWidth }}>
          {/* Header */}
          <div className="flex sticky top-0 bg-[#1e1e22] z-10 border-b border-white/10">
            {/* Paper title column - fixed */}
            <div className="sticky left-0 w-[280px] flex-shrink-0 px-4 py-3 bg-[#1e1e22] border-r border-white/10 z-20">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-white/40" />
                <span className="text-sm font-medium text-white/80">Paper</span>
              </div>
            </div>

            {/* Dynamic columns */}
            {sheet.columns.map((column) => (
              <div
                key={column.id}
                style={{ width: column.width }}
                className="flex-shrink-0 px-3 py-3 border-r border-white/5 group relative"
              >
                <button
                  onClick={() => setEditingColumnId(column.id)}
                  className="flex items-center gap-1.5 text-sm font-medium text-white/80 hover:text-white transition-colors"
                >
                  {column.name}
                  <Settings2 className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50" />
                </button>
                <p className="text-xs text-white/40 mt-0.5 truncate">{column.description}</p>

                {/* Resize handle */}
                <div
                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 transition-colors"
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
                className="p-1.5 text-white/30 hover:text-white/60 hover:bg-white/10 rounded transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Rows */}
          {sheet.rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileSpreadsheet className="w-12 h-12 text-white/20 mb-4" />
              <p className="text-white/60 mb-2">No papers selected</p>
              <p className="text-sm text-white/40">Select papers from the left panel to add them to this sheet</p>
            </div>
          ) : (
            sheet.rows.map((row, rowIndex) => {
              const paper = papers.find(p => p.id === row.paperId);
              return (
                <div
                  key={row.id}
                  className={`flex border-b border-white/5 hover:bg-white/[0.02] transition-colors ${
                    rowIndex % 2 === 0 ? 'bg-white/[0.01]' : ''
                  }`}
                >
                  {/* Paper title - fixed */}
                  <div className="sticky left-0 w-[280px] flex-shrink-0 px-4 py-3 bg-[#161618] border-r border-white/10 z-10">
                    <div className="flex items-start gap-2">
                      <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                        row.status === 'completed' ? 'bg-green-400' :
                        row.status === 'processing' ? 'bg-blue-400 animate-pulse' :
                        row.status === 'error' ? 'bg-red-400' : 'bg-white/30'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/90 line-clamp-2">{row.paperTitle}</p>
                        {paper?.metadata?.venue && (
                          <p className="text-xs text-white/40 mt-0.5">{paper.metadata.venue}</p>
                        )}
                      </div>
                      <button
                        onClick={() => onRunExtraction([row.id])}
                        disabled={isExtracting}
                        className="p-1 text-white/30 hover:text-white/60 rounded opacity-0 group-hover:opacity-100 transition-all"
                        title="Re-run extraction for this row"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Data cells */}
                  {sheet.columns.map((column) => (
                    <div
                      key={column.id}
                      style={{ width: column.width, minWidth: column.width }}
                      className="flex-shrink-0 border-r border-white/5"
                    >
                      <EditableCell
                        cell={row.cells[column.id]}
                        column={column}
                        status={row.status}
                        isSelected={selectedCell?.rowId === row.id && selectedCell?.columnId === column.id}
                        isEditing={editingCell?.rowId === row.id && editingCell?.columnId === column.id}
                        onSelect={() => {
                          setSelectedCell({ rowId: row.id, columnId: column.id });
                          setEditingCell(null);
                        }}
                        onStartEdit={() => {
                          setSelectedCell({ rowId: row.id, columnId: column.id });
                          setEditingCell({ rowId: row.id, columnId: column.id });
                        }}
                        onEndEdit={() => setEditingCell(null)}
                        onUpdateValue={(value) => handleCellUpdate(row.id, column.id, value)}
                        onNavigate={handleNavigate}
                      />
                    </div>
                  ))}

                  {/* Spacer */}
                  <div className="flex-shrink-0 w-[50px]" />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Column config modal */}
      {editingColumn && (
        <ColumnConfig
          column={editingColumn}
          onUpdate={handleUpdateColumn}
          onDelete={() => handleDeleteColumn(editingColumn.id)}
          onClose={() => setEditingColumnId(null)}
        />
      )}

      {/* Multi-column add modal */}
      {showMultiColumnModal && (
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
  onUpdateSheet: (sheet: LitReviewSheet) => void;
  onApplyPreset: (preset: LitReviewPreset) => void;
  onSaveVersion: () => void;
  onRestoreVersion: (versionId: string) => void;
  onExportExcel: () => void;
  onExportCSV: () => void;
}

function ConfigPanel({
  sheet,
  onApplyPreset,
  onSaveVersion,
  onRestoreVersion,
  onExportExcel,
  onExportCSV,
}: ConfigPanelProps) {
  const [showPresets, setShowPresets] = useState(true);
  const [showVersions, setShowVersions] = useState(false);
  const [showExport, setShowExport] = useState(false);

  return (
    <div className="flex flex-col h-full bg-[#1a1a1e] border-l border-white/10 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <h2 className="text-sm font-semibold text-white/90">Configuration</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Presets section */}
        <div className="border-b border-white/10">
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-white/80 hover:bg-white/5"
          >
            <div className="flex items-center gap-2">
              <Columns className="w-4 h-4 text-white/50" />
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
                  className="w-full p-3 text-left bg-white/5 hover:bg-white/10 rounded-lg transition-colors group"
                >
                  <p className="text-sm text-white/90 font-medium">{preset.name}</p>
                  {preset.description && (
                    <p className="text-xs text-white/50 mt-1">{preset.description}</p>
                  )}
                  <p className="text-xs text-white/40 mt-2">
                    {preset.columns.length} columns
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Version History section */}
        <div className="border-b border-white/10">
          <button
            onClick={() => setShowVersions(!showVersions)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-white/80 hover:bg-white/5"
          >
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-white/50" />
              <span>Version History</span>
              {sheet.versions.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] bg-white/10 text-white/50 rounded">
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
                className="w-full flex items-center gap-2 px-3 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-sm hover:bg-blue-500/30 transition-colors"
              >
                <Save className="w-4 h-4" />
                Save Current Version
              </button>

              {sheet.versions.length === 0 ? (
                <p className="text-xs text-white/40 text-center py-4">No saved versions yet</p>
              ) : (
                sheet.versions.slice().reverse().map((version) => (
                  <button
                    key={version.id}
                    onClick={() => onRestoreVersion(version.id)}
                    className={`w-full p-3 text-left rounded-lg transition-colors ${
                      sheet.currentVersionId === version.id 
                        ? 'bg-blue-500/20 border border-blue-500/30' 
                        : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-white/90">{version.name}</p>
                      {sheet.currentVersionId === version.id && (
                        <span className="text-[10px] text-blue-400 uppercase">Current</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-white/40">
                      <Clock className="w-3 h-3" />
                      {version.createdAt.toLocaleDateString()} {version.createdAt.toLocaleTimeString()}
                    </div>
                    <p className="text-xs text-white/40 mt-1">
                      {version.columns.length} columns • {version.rows.length} rows
                    </p>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Export section */}
        <div className="border-b border-white/10">
          <button
            onClick={() => setShowExport(!showExport)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-white/80 hover:bg-white/5"
          >
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-white/50" />
              <span>Export</span>
            </div>
            {showExport ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          {showExport && (
            <div className="px-4 pb-4 space-y-2">
              <button
                onClick={onExportExcel}
                className="w-full flex items-center gap-3 px-3 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4 text-green-400" />
                <div className="text-left">
                  <p className="text-sm text-white/90">Download Excel</p>
                  <p className="text-xs text-white/50">.xlsx format</p>
                </div>
              </button>
              <button
                onClick={onExportCSV}
                className="w-full flex items-center gap-3 px-3 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              >
                <FileText className="w-4 h-4 text-blue-400" />
                <div className="text-left">
                  <p className="text-sm text-white/90">Download CSV</p>
                  <p className="text-xs text-white/50">.csv format</p>
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
                className="w-full flex items-center gap-3 px-3 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              >
                <Copy className="w-4 h-4 text-purple-400" />
                <div className="text-left">
                  <p className="text-sm text-white/90">Copy to Clipboard</p>
                  <p className="text-xs text-white/50">Paste into Google Sheets</p>
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

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [showNewSheetModal, setShowNewSheetModal] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [showSheetMenu, setShowSheetMenu] = useState(false);

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
      }
    }

    loadData();
  }, [currentProject]);

  // Save to localStorage when in fallback mode
  useEffect(() => {
    if (useLocalStorage && currentProject && sheets.length >= 0) {
      saveSheetsToStorage(currentProject.id, sheets);
    }
  }, [sheets, currentProject, useLocalStorage]);

  // Computed values
  const currentSheet = useMemo(() => 
    sheets.find(s => s.id === currentSheetId), 
    [sheets, currentSheetId]
  );

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    papers.forEach(p => p.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [papers]);

  const selectedPaperIds = useMemo(() => 
    new Set(currentSheet?.selectedPaperIds || []),
    [currentSheet]
  );

  // Handlers
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

  const handleTogglePaper = async (paperId: string) => {
    if (!currentSheet) return;

    const paper = papers.find(p => p.id === paperId);
    if (!paper) return;

    let newSelectedIds: string[];
    let newRows: LitReviewRow[];

    if (selectedPaperIds.has(paperId)) {
      // Remove paper
      newSelectedIds = currentSheet.selectedPaperIds.filter(id => id !== paperId);
      newRows = currentSheet.rows.filter(r => r.paperId !== paperId);
      
      // Delete row from database (skip if using localStorage)
      if (!useLocalStorage) {
        try {
          await deleteLitReviewRowByPaper(currentSheet.id, paperId);
        } catch (error) {
          console.error('Error removing row:', error);
        }
      }
    } else {
      // Add paper
      newSelectedIds = [...currentSheet.selectedPaperIds, paperId];
      const newRow: LitReviewRow = {
        id: uuidv4(),
        paperId,
        paperTitle: paper.title,
        cells: {},
        status: 'pending',
      };
      newRows = [...currentSheet.rows, newRow];
      
      // Add row to database (skip if using localStorage)
      if (!useLocalStorage) {
        try {
          await upsertLitReviewRow(currentSheet.id, newRow);
        } catch (error) {
          console.error('Error adding row:', error);
        }
      }
    }

    handleUpdateSheet({
      ...currentSheet,
      selectedPaperIds: newSelectedIds,
      rows: newRows,
    });
  };

  const handleSelectAllPapers = async () => {
    if (!currentSheet) return;

    const filteredPapers = papers.filter(p => {
      const matchesSearch = !searchQuery || 
        p.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTag = !filterTag || p.tags.includes(filterTag);
      return matchesSearch && matchesTag;
    });

    const newSelectedIds = [...new Set([...currentSheet.selectedPaperIds, ...filteredPapers.map(p => p.id)])];
    const existingPaperIds = new Set(currentSheet.rows.map(r => r.paperId));
    
    const newRows = [...currentSheet.rows];
    const rowsToAdd: LitReviewRow[] = [];
    
    filteredPapers.forEach(paper => {
      if (!existingPaperIds.has(paper.id)) {
        const newRow: LitReviewRow = {
          id: uuidv4(),
          paperId: paper.id,
          paperTitle: paper.title,
          cells: {},
          status: 'pending',
        };
        newRows.push(newRow);
        rowsToAdd.push(newRow);
      }
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
  };

  const handleDeselectAllPapers = () => {
    if (!currentSheet) return;
    handleUpdateSheet({
      ...currentSheet,
      selectedPaperIds: [],
      rows: [],
    });
  };

  const handleApplyPreset = (preset: LitReviewPreset) => {
    if (!currentSheet) return;
    handleUpdateSheet({
      ...currentSheet,
      columns: preset.columns.map(c => ({ ...c, id: uuidv4() })),
      // Reset cells since columns changed
      rows: currentSheet.rows.map(r => ({ ...r, cells: {}, status: 'pending' as const })),
    });
  };

  const handleRunExtraction = async (rowIds?: string[]) => {
    if (!currentSheet) {
      return;
    }

    if (currentSheet.columns.length === 0) {
      alert('Please add at least one column first');
      return;
    }

    setIsExtracting(true);

    const rowsToProcess = rowIds 
      ? currentSheet.rows.filter(r => rowIds.includes(r.id))
      : currentSheet.rows;

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

        // Extract each column
        const cells: Record<string, LitReviewCell> = {};
        for (const column of currentSheet.columns) {
          const cell = await extractColumnValue(paperText, column);
          cells[column.id] = cell;
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

  const handleSaveVersion = async () => {
    if (!currentSheet) return;

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

  const handleRestoreVersion = (versionId: string) => {
    if (!currentSheet) return;

    const version = currentSheet.versions.find(v => v.id === versionId);
    if (!version) return;

    handleUpdateSheet({
      ...currentSheet,
      columns: [...version.columns],
      rows: version.rows.map(r => ({ ...r })),
      currentVersionId: versionId,
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
      <div className="h-screen bg-[#0d0d0f] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
          <p className="text-white/60">Loading literature review...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0d0d0f] flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-3 bg-[#1a1a1e] border-b border-white/10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 text-white/60 hover:text-white/90 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-white">Literature Review</h1>
            <p className="text-xs text-white/50">{currentProject?.name}</p>
          </div>
        </div>

        {/* Sheet tabs */}
        <div className="flex items-center gap-2">
          {sheets.map((sheet) => (
            <div
              key={sheet.id}
              onClick={() => setCurrentSheetId(sheet.id)}
              className={`relative flex items-center px-4 py-2 text-sm rounded-lg transition-all cursor-pointer ${
                currentSheetId === sheet.id
                  ? 'bg-white/10 text-white'
                  : 'text-white/60 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              {sheet.name}
              {currentSheetId === sheet.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSheetMenu(!showSheetMenu);
                  }}
                  className="ml-2 p-0.5 hover:bg-white/10 rounded"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => setShowNewSheetModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white/60 hover:text-white/80 hover:bg-white/5 rounded-lg transition-colors"
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
              selectedPaperIds={selectedPaperIds}
              onTogglePaper={handleTogglePaper}
              onSelectAll={handleSelectAllPapers}
              onDeselectAll={handleDeselectAllPapers}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filterTag={filterTag}
              onFilterTagChange={setFilterTag}
              allTags={allTags}
            />
          </div>

          {/* Center - Spreadsheet */}
          <Spreadsheet
            sheet={currentSheet}
            papers={papers}
            onUpdateSheet={handleUpdateSheet}
            onRunExtraction={handleRunExtraction}
            isExtracting={isExtracting}
          />

          {/* Right panel - Config */}
          <div className="w-72 flex-shrink-0">
            <ConfigPanel
              sheet={currentSheet}
              onUpdateSheet={handleUpdateSheet}
              onApplyPreset={handleApplyPreset}
              onSaveVersion={handleSaveVersion}
              onRestoreVersion={handleRestoreVersion}
              onExportExcel={handleExportExcel}
              onExportCSV={handleExportCSV}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center">
          <FileSpreadsheet className="w-16 h-16 text-white/20 mb-6" />
          <h2 className="text-xl font-medium text-white/80 mb-2">No sheets yet</h2>
          <p className="text-white/50 mb-6 text-center max-w-md">
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
          <div className="fixed top-14 right-1/2 translate-x-1/2 bg-[#252529] border border-white/10 rounded-lg shadow-xl z-50 py-1 min-w-[160px]">
            <button
              onClick={() => {
                const newName = prompt('Rename sheet:', currentSheet.name);
                if (newName) {
                  handleUpdateSheet({ ...currentSheet, name: newName.trim() });
                }
                setShowSheetMenu(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
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
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
            <div className="border-t border-white/10 my-1" />
            <button
              onClick={() => {
                if (confirm('Delete this sheet? This cannot be undone.')) {
                  handleDeleteSheet(currentSheet.id);
                }
                setShowSheetMenu(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
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
          <div className="bg-[#1e1e22] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <h3 className="text-lg font-medium text-white">Create New Sheet</h3>
              <button
                onClick={() => { setShowNewSheetModal(false); setNewSheetName(''); }}
                className="p-1 text-white/50 hover:text-white/80"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5">
              <label className="block text-xs font-medium text-white/60 mb-2">Sheet Name</label>
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
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-white/10">
              <button
                onClick={() => { setShowNewSheetModal(false); setNewSheetName(''); }}
                className="px-4 py-2 text-sm text-white/60 hover:text-white/80"
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
    </div>
  );
}

export default LitReview;
