import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  ArrowLeft,
  BookOpen,
  Sparkles,
  Loader2,
  FileText,
  ChevronRight,
  Edit3,
  Check,
  X,
  RefreshCw,
  Archive,
} from 'lucide-react';
import type { Paper, JournalEntry, KeyInsight, Note } from '../types';
import {
  getAllPapers,
  getAllJournalEntries,
  addJournalEntry,
  updateJournalEntry,
  getSettings,
  getAllNotes,
} from '../lib/database';

// Group papers by the dates their notes were created
function groupPapersByNotes(
  papers: Paper[],
  notes: Note[]
): Map<string, Paper[]> {
  const groups = new Map<string, Paper[]>();
  const paperMap = new Map(papers.map(p => [p.id, p]));

  notes.forEach(note => {
    // Use the note's createdAt date for grouping (convert to local date)
    const noteDate = new Date(note.createdAt);
    const dateStr = `${noteDate.getFullYear()}-${String(noteDate.getMonth() + 1).padStart(2, '0')}-${String(noteDate.getDate()).padStart(2, '0')}`;

    const paper = paperMap.get(note.paperId);
    if (!paper) return;

    if (!groups.has(dateStr)) {
      groups.set(dateStr, []);
    }

    // Avoid duplicates: only add if not already in that day's list
    const dayPapers = groups.get(dateStr)!;
    if (!dayPapers.some(p => p.id === paper.id)) {
      dayPapers.push(paper);
    }
  });

  return groups;
}

// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00'); // Avoid timezone issues
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Use local date formatting (same as how notes are grouped)
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  if (dateStr === todayStr) return 'Today';
  if (dateStr === yesterdayStr) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

export default function Journal() {
  const navigate = useNavigate();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [journalEntries, setJournalEntries] = useState<Map<string, JournalEntry>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [generatingDate, setGeneratingDate] = useState<string | null>(null);
  const [refreshingSynthesisDate, setRefreshingSynthesisDate] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingSynthesis, setEditingSynthesis] = useState('');
  const [editingInsights, setEditingInsights] = useState<KeyInsight[]>([]);
  const [hoveredPaperId, setHoveredPaperId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [loadedPapers, entries, loadedNotes] = await Promise.all([
        getAllPapers(),
        getAllJournalEntries(),
        getAllNotes(),
      ]);

      setPapers(loadedPapers);
      setNotes(loadedNotes);

      const entryMap = new Map<string, JournalEntry>();
      entries.forEach(e => entryMap.set(e.date, e));
      setJournalEntries(entryMap);
    } catch (error) {
      console.error('Error loading journal data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const generateEntry = async (dateStr: string, datePapers: Paper[]) => {
    setGeneratingDate(dateStr);

    try {
      const settings = await getSettings();
      if (!settings.openaiApiKey) {
        alert('Please add your OpenAI API key in Settings to use AI synthesis.');
        setGeneratingDate(null);
        return;
      }

      // Collect paper metadata and notes
      const paperData: Array<{
        title: string;
        authors?: string;
        venue?: string;
        date?: string;
        methodology?: string;
        conclusion?: string;
        limitation?: string;
        notes?: string;
      }> = [];

      datePapers.forEach(paper => {
        const meta = paper.metadata || {};
        paperData.push({
          title: paper.title,
          authors: paper.authors,
          venue: meta.venue,
          date: meta.date,
          methodology: meta.methodology,
          conclusion: meta.conclusion,
          limitation: meta.limitation,
          notes: meta.notes,
        });
      });

      // Build prompt with full paper information (indexed)
      const papersText = paperData
        .map((p, idx) => {
          const parts: string[] = [];
          parts.push(`[Paper ${idx}] "${p.title}"`);
          if (p.authors) parts.push(`Authors: ${p.authors}`);
          if (p.venue) parts.push(`Venue: ${p.venue}`);
          if (p.date) parts.push(`Date: ${p.date}`);
          if (p.methodology) parts.push(`Methodology: ${p.methodology}`);
          if (p.conclusion) parts.push(`Conclusion: ${p.conclusion}`);
          if (p.limitation) parts.push(`Limitations: ${p.limitation}`);
          if (p.notes) parts.push(`My Notes: ${p.notes}`);
          return parts.join('\n');
        })
        .join('\n\n---\n\n');

      const researchContext = settings.researchContext
        ? `\n\nMy Research Context:\n${settings.researchContext}`
        : '';

      const prompt = `I read ${datePapers.length} research paper${datePapers.length > 1 ? 's' : ''} today. Summarize what I learned.
${researchContext}

Papers I Read (indexed 0 to ${datePapers.length - 1}):
${papersText}

CRITICAL RULES:
- For Methodology, Conclusion, and Limitations: summarize these as needed.
- For "My Notes" field: This is where I write my own thoughts on applying learnings to my research. If a paper has NO "My Notes" section or it's empty, do NOT write ANYTHING about research applications, implications for my work, or how I might use the findings. Only mention my personal research applications if I explicitly wrote something in "My Notes".
- Focus only on what the paper found, not what I might do with it (unless I wrote notes).

Please provide:
1. A synthesis paragraph (4-6 sentences) that recaps paper methodology/findings. ONLY mention my research applications if "My Notes" contained text. Write in first person. Be plain and succinct.
2. A list of 3-6 key insights about the papers' findings. Do NOT include paper titles—provide the paperIndex (0-based) separately.

Respond in this exact JSON format:
{
  "synthesis": "...",
  "keyInsights": [
    { "text": "insight text here", "paperIndex": 0 },
    { "text": "another insight", "paperIndex": 1 }
  ]
}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are helping me write my personal research journal. Write in first person from my perspective (use "I", "my research", "I found", etc.). Use plain, succinct language—avoid dramatic or filler words like "insightful", "compelling", "profound", "fascinating", "exciting". Just state facts and observations directly. Respond with valid JSON only.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from AI');
      }

      // Parse JSON response
      const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());

      // Convert AI-generated insights to KeyInsight objects
      const aiInsights: KeyInsight[] = (parsed.keyInsights || []).map((insight: { text: string; paperIndex?: number } | string) => {
        // Handle both old string format and new object format
        if (typeof insight === 'string') {
          return { id: uuidv4(), text: insight, isManual: false };
        }
        const paperIndex = insight.paperIndex ?? 0;
        const paperId = datePapers[paperIndex]?.id;
        return {
          id: uuidv4(),
          text: insight.text,
          isManual: false,
          paperId,
        };
      });

      const entry: JournalEntry = {
        id: uuidv4(),
        date: dateStr,
        paperIds: datePapers.map(p => p.id),
        synthesis: parsed.synthesis || '',
        keyInsights: aiInsights,
        isGenerated: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await addJournalEntry(entry);
      setJournalEntries(prev => {
        const newMap = new Map(prev);
        newMap.set(dateStr, entry);
        return newMap;
      });
    } catch (error) {
      console.error('Error generating journal entry:', error);
      alert('Failed to generate entry. Please try again.');
    } finally {
      setGeneratingDate(null);
    }
  };

  const refreshSynthesis = async (dateStr: string, datePapers: Paper[]) => {
    setRefreshingSynthesisDate(dateStr);

    try {
      const settings = await getSettings();
      if (!settings.openaiApiKey) {
        alert('Please add your OpenAI API key in Settings to use AI synthesis.');
        setRefreshingSynthesisDate(null);
        return;
      }

      const entry = journalEntries.get(dateStr);
      if (!entry) return;

      // Collect paper metadata and notes
      const paperData: Array<{
        title: string;
        authors?: string;
        venue?: string;
        date?: string;
        methodology?: string;
        conclusion?: string;
        limitation?: string;
        notes?: string;
      }> = [];

      datePapers.forEach(paper => {
        const meta = paper.metadata || {};
        paperData.push({
          title: paper.title,
          authors: paper.authors,
          venue: meta.venue,
          date: meta.date,
          methodology: meta.methodology,
          conclusion: meta.conclusion,
          limitation: meta.limitation,
          notes: meta.notes,
        });
      });

      // Build prompt with full paper information (indexed)
      const papersText = paperData
        .map((p, idx) => {
          const parts: string[] = [];
          parts.push(`[Paper ${idx}] "${p.title}"`);
          if (p.authors) parts.push(`Authors: ${p.authors}`);
          if (p.venue) parts.push(`Venue: ${p.venue}`);
          if (p.date) parts.push(`Date: ${p.date}`);
          if (p.methodology) parts.push(`Methodology: ${p.methodology}`);
          if (p.conclusion) parts.push(`Conclusion: ${p.conclusion}`);
          if (p.limitation) parts.push(`Limitations: ${p.limitation}`);
          if (p.notes) parts.push(`My Notes: ${p.notes}`);
          return parts.join('\n');
        })
        .join('\n\n---\n\n');

      const researchContext = settings.researchContext
        ? `\n\nMy Research Context:\n${settings.researchContext}`
        : '';

      const prompt = `I read ${datePapers.length} research paper${datePapers.length > 1 ? 's' : ''} today. Summarize what I learned.
${researchContext}

Papers I Read (indexed 0 to ${datePapers.length - 1}):
${papersText}

IMPORTANT RULES:
- For Methodology, Conclusion, and Limitations: you may synthesize and summarize as needed.
- For "My Notes": these are my personal thoughts on how to apply learnings to my research. ONLY include these if I explicitly wrote something. Do NOT invent or assume what I might think.
- If there are no notes to synthesize, respond with synthesis: "N/A" and empty keyInsights.

Please provide:
1. A synthesis paragraph (4-6 sentences) that recaps paper methodology/findings and connects themes. If I wrote personal notes, include how I plan to apply the learnings. Write in first person. Be plain and succinct.
2. A list of 3-6 key insights. Do NOT include the paper title in the text—provide the paperIndex (0-based) separately.

Respond in this exact JSON format:
{
  "synthesis": "...",
  "keyInsights": [
    { "text": "insight text here", "paperIndex": 0 },
    { "text": "another insight", "paperIndex": 1 }
  ]
}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are helping me write my personal research journal. Write in first person from my perspective (use "I", "my research", "I found", etc.). Use plain, succinct language—avoid dramatic or filler words like "insightful", "compelling", "profound", "fascinating", "exciting". Just state facts and observations directly. Respond with valid JSON only.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from AI');
      }

      // Parse JSON response
      const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
      const synthesis = parsed.synthesis || '';

      // Convert AI-generated insights to KeyInsight objects
      const newAiInsights: KeyInsight[] = (parsed.keyInsights || []).map((insight: { text: string; paperIndex?: number } | string) => {
        // Handle both old string format and new object format
        if (typeof insight === 'string') {
          return { id: uuidv4(), text: insight, isManual: false };
        }
        const paperIndex = insight.paperIndex ?? 0;
        const paperId = datePapers[paperIndex]?.id;
        return {
          id: uuidv4(),
          text: insight.text,
          isManual: false,
          paperId,
        };
      });

      // Preserve manual insights, replace AI-generated ones
      const manualInsights = entry.keyInsights.filter(insight => insight.isManual);
      const combinedInsights = [...newAiInsights, ...manualInsights];

      // Update entry with new synthesis and refreshed insights
      const updated: JournalEntry = {
        ...entry,
        synthesis,
        keyInsights: combinedInsights,
        updatedAt: new Date(),
      };

      await updateJournalEntry(updated);
      setJournalEntries(prev => {
        const newMap = new Map(prev);
        newMap.set(dateStr, updated);
        return newMap;
      });
    } catch (error) {
      console.error('Error refreshing synthesis:', error);
      alert('Failed to refresh synthesis. Please try again.');
    } finally {
      setRefreshingSynthesisDate(null);
    }
  };

  const startEditing = (entry: JournalEntry) => {
    setEditingDate(entry.date);
    setEditingSynthesis(entry.synthesis);
    setEditingInsights([...entry.keyInsights]);
  };

  const saveEditing = async () => {
    if (!editingDate) return;

    const entry = journalEntries.get(editingDate);
    if (!entry) return;

    const updated: JournalEntry = {
      ...entry,
      synthesis: editingSynthesis,
      keyInsights: editingInsights.filter(i => i.text.trim()),
      updatedAt: new Date(),
    };

    await updateJournalEntry(updated);
    setJournalEntries(prev => {
      const newMap = new Map(prev);
      newMap.set(editingDate, updated);
      return newMap;
    });
    setEditingDate(null);
  };

  const cancelEditing = () => {
    setEditingDate(null);
    setEditingSynthesis('');
    setEditingInsights([]);
  };

  const updateInsight = (index: number, value: string) => {
    const newInsights = [...editingInsights];
    newInsights[index] = { ...newInsights[index], text: value };
    setEditingInsights(newInsights);
  };

  const addInsight = () => {
    // Manually added insights are marked as manual
    const newInsight: KeyInsight = {
      id: uuidv4(),
      text: '',
      isManual: true,
    };
    setEditingInsights([...editingInsights, newInsight]);
  };

  const removeInsight = (index: number) => {
    setEditingInsights(editingInsights.filter((_, i) => i !== index));
  };

  // Group papers by date based on note activity
  const papersByDate = groupPapersByNotes(papers, notes);
  const sortedDates = Array.from(papersByDate.keys()).sort((a: string, b: string) => b.localeCompare(a));

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--bg-primary)]/80 backdrop-blur-xl border-b border-[var(--border-default)]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-full hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[var(--text-secondary)]" />
            </button>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[var(--text-primary)]" />
              <h1 className="text-base font-semibold text-[var(--text-primary)]">Journal</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin mb-4" />
            <p className="text-sm text-[var(--text-muted)]">Loading journal...</p>
          </div>
        ) : sortedDates.length === 0 ? (
          <div className="text-center py-20">
            <BookOpen className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
            <h2 className="text-base font-medium text-[var(--text-secondary)] mb-2">No reading history yet</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Start reading papers to see your journal entries here.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {sortedDates.map(dateStr => {
              const datePapers = papersByDate.get(dateStr) || [];
              const entry = journalEntries.get(dateStr);
              const isGenerating = generatingDate === dateStr;
              const isEditing = editingDate === dateStr;

              return (
                <div key={dateStr} className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-4 top-8 bottom-0 w-px bg-[var(--border-default)]" />

                  {/* Date header */}
                  <div className="flex items-center gap-3 mb-4">
                    {formatDate(dateStr) === 'Today' ? (
                      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center z-10 animate-pulse-subtle">
                        <div className="w-2 h-2 rounded-full bg-white" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center z-10">
                        <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                      </div>
                    )}
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">
                      {formatDate(dateStr)}
                    </h2>
                    <span className="text-xs text-[var(--text-muted)]">
                      {datePapers.length} paper{datePapers.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="ml-11 space-y-4">
                    {/* Papers list */}
                    <div className="flex flex-wrap gap-2">
                      {datePapers.map(paper => (
                        <button
                          key={paper.id}
                          onClick={() => navigate(`/reader/${paper.id}`, { state: { from: '/journal' } })}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all text-xs ${hoveredPaperId === paper.id
                            ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/30'
                            : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                        >
                          <FileText className="w-3 h-3" />
                          <span className="truncate max-w-[200px]">{paper.title}</span>
                          {paper.isArchived && (
                            <span title="Archived">
                              <Archive className="w-3 h-3 text-[var(--text-muted)]" />
                            </span>
                          )}
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      ))}
                    </div>

                    {/* Journal entry card */}
                    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-default)] overflow-hidden">
                      {!entry ? (
                        /* Placeholder - no entry yet */
                        <div className="p-6">
                          {isGenerating ? (
                            /* Apple-like thinking state */
                            <div className="flex flex-col items-center py-8">
                              <div className="relative mb-4">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--bg-tertiary)] to-[var(--bg-secondary)] flex items-center justify-center">
                                  <Sparkles className="w-5 h-5 text-[var(--text-muted)] animate-pulse" />
                                </div>
                                <div className="absolute inset-0 rounded-full border-2 border-[var(--text-muted)] border-t-transparent animate-spin" />
                              </div>
                              <p className="text-sm text-[var(--text-secondary)] mb-1">Synthesizing your notes...</p>
                              <p className="text-xs text-[var(--text-muted)]">
                                Reading through {datePapers.length} paper{datePapers.length !== 1 ? 's' : ''}
                              </p>
                            </div>
                          ) : (
                            /* Empty state */
                            <div className="text-center py-4">
                              <p className="text-sm text-[var(--text-muted)] mb-4">
                                Create an AI synthesis of your reading notes for this day.
                              </p>
                              <button
                                onClick={() => generateEntry(dateStr, datePapers)}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] text-sm font-medium hover:opacity-90 transition-opacity"
                              >
                                <Sparkles className="w-4 h-4" />
                                Create Entry
                              </button>
                            </div>
                          )}
                        </div>
                      ) : isEditing ? (
                        /* Editing state */
                        <div className="p-6 space-y-4">
                          <div>
                            <label className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">
                              Synthesis
                            </label>
                            <textarea
                              value={editingSynthesis}
                              onChange={(e) => setEditingSynthesis(e.target.value)}
                              rows={4}
                              className="w-full text-sm p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] resize-none"
                            />
                          </div>

                          <div>
                            <label className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">
                              Key Insights
                            </label>
                            <div className="space-y-2">
                              {editingInsights.map((insight, idx) => {
                                const insightText = typeof insight === 'string' ? insight : (insight.text || '');
                                const isManual = typeof insight === 'object' && insight.isManual;
                                const insightId = typeof insight === 'object' ? insight.id : `edit-${idx}`;

                                return (
                                  <div key={insightId} className="flex items-start gap-2">
                                    <span className={`mt-2 text-xs ${isManual ? 'text-[var(--text-muted)]' : 'text-[var(--accent-primary)]/60'}`}>
                                      {isManual ? '•' : '✦'}
                                    </span>
                                    <input
                                      type="text"
                                      value={insightText}
                                      onChange={(e) => updateInsight(idx, e.target.value)}
                                      className="flex-1 text-sm p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)]"
                                      placeholder={isManual ? "Your insight..." : ""}
                                    />
                                    <button
                                      onClick={() => removeInsight(idx)}
                                      className="p-2 text-[var(--text-muted)] hover:text-red-500 transition-colors"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                );
                              })}
                              <button
                                onClick={addInsight}
                                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                              >
                                + Add insight
                              </button>
                            </div>
                          </div>

                          <div className="flex justify-end gap-2 pt-2">
                            <button
                              onClick={cancelEditing}
                              className="px-4 py-2 rounded-full text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={saveEditing}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] text-sm font-medium hover:opacity-90 transition-opacity"
                            >
                              <Check className="w-4 h-4" />
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Display state */
                        <div className="p-6">
                          <div className="flex items-start justify-between mb-4">
                            {refreshingSynthesisDate === dateStr ? (
                              <div className="flex-1 flex items-center gap-2 text-sm text-[var(--text-muted)]">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Refreshing synthesis...</span>
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--text-primary)] leading-relaxed flex-1">
                                {entry.synthesis}
                              </p>
                            )}
                            <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                              <button
                                onClick={() => refreshSynthesis(dateStr, datePapers)}
                                disabled={refreshingSynthesisDate === dateStr}
                                className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Refresh synthesis"
                              >
                                <RefreshCw className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => startEditing(entry)}
                                className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                                title="Edit entry"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {entry.keyInsights.length > 0 && refreshingSynthesisDate !== dateStr && (
                            <div className="mt-4 pt-4 border-t border-[var(--border-default)]">
                              <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-3 uppercase tracking-wide">
                                Key Insights
                              </h4>
                              <ul className="space-y-2">
                                {entry.keyInsights.map((insight) => {
                                  // Handle case where insight might be malformed or a string
                                  const insightText = typeof insight === 'string'
                                    ? insight
                                    : (insight.text || '');
                                  const isManual = typeof insight === 'object' && insight.isManual;
                                  const paperId = typeof insight === 'object' ? insight.paperId : undefined;
                                  const insightId = typeof insight === 'object' ? insight.id : String(insight);

                                  return (
                                    <li
                                      key={insightId}
                                      className={`flex items-start gap-2 text-sm text-[var(--text-secondary)] ${paperId ? 'cursor-pointer hover:text-[var(--text-primary)] transition-colors' : ''
                                        }`}
                                      onMouseEnter={() => paperId && setHoveredPaperId(paperId)}
                                      onMouseLeave={() => setHoveredPaperId(null)}
                                      onClick={() => paperId && navigate(`/reader/${paperId}`, { state: { from: '/journal' } })}
                                    >
                                      <span className={`mt-0.5 text-xs ${isManual ? 'text-[var(--text-muted)]' : 'text-[var(--accent-primary)]/60'}`}>
                                        {isManual ? '•' : '✦'}
                                      </span>
                                      <span>{insightText}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

