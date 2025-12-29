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
} from 'lucide-react';
import type { Paper, JournalEntry } from '../types';
import {
  getAllPapers,
  getAllJournalEntries,
  addJournalEntry,
  updateJournalEntry,
  getSettings,
} from '../lib/database';

// Group papers by the date they were read (lastOpenedAt or uploadedAt)
function groupPapersByDate(papers: Paper[]): Map<string, Paper[]> {
  const groups = new Map<string, Paper[]>();
  
  papers.forEach(paper => {
    // Use lastOpenedAt if available, otherwise uploadedAt
    const date = paper.lastOpenedAt || paper.uploadedAt;
    const dateStr = new Date(date).toISOString().split('T')[0]; // YYYY-MM-DD
    
    if (!groups.has(dateStr)) {
      groups.set(dateStr, []);
    }
    groups.get(dateStr)!.push(paper);
  });
  
  return groups;
}

// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00'); // Avoid timezone issues
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const todayStr = today.toISOString().split('T')[0];
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
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
  const [journalEntries, setJournalEntries] = useState<Map<string, JournalEntry>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [generatingDate, setGeneratingDate] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingSynthesis, setEditingSynthesis] = useState('');
  const [editingInsights, setEditingInsights] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [loadedPapers, entries] = await Promise.all([
        getAllPapers(),
        getAllJournalEntries(),
      ]);
      
      // Only include papers that have been read
      const readPapers = loadedPapers.filter(p => p.isRead);
      setPapers(readPapers);
      
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

      // Collect all notes from papers read that day
      const paperNotes: { title: string; notes: string }[] = [];
      datePapers.forEach(paper => {
        if (paper.metadata?.notes) {
          paperNotes.push({
            title: paper.title,
            notes: paper.metadata.notes,
          });
        }
      });

      if (paperNotes.length === 0) {
        // Create empty entry if no notes
        const entry: JournalEntry = {
          id: uuidv4(),
          date: dateStr,
          paperIds: datePapers.map(p => p.id),
          synthesis: 'No notes available for synthesis. Add notes to papers using the AI autofill feature in the Reader view.',
          keyInsights: [],
          isGenerated: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await addJournalEntry(entry);
        setJournalEntries(prev => new Map(prev).set(dateStr, entry));
        setGeneratingDate(null);
        return;
      }

      // Build prompt
      const notesText = paperNotes
        .map(pn => `Paper: "${pn.title}"\nNotes: ${pn.notes}`)
        .join('\n\n---\n\n');

      const researchContext = settings.researchContext
        ? `\n\nMy Research Context:\n${settings.researchContext}`
        : '';

      const prompt = `I read ${datePapers.length} research paper${datePapers.length > 1 ? 's' : ''} today. Based on the notes I took, synthesize my learnings and extract key insights.
${researchContext}

Papers and Notes:
${notesText}

Please provide:
1. A synthesis paragraph (2-4 sentences) that connects the key themes and learnings across these papers. Write in first person as if I'm writing my own research journal (use "my research", "I noticed", etc.). Be direct and specific.
2. A list of 3-6 bullet points with actionable insights, potential research directions, or important takeaways. Also in first person.

Respond in this exact JSON format:
{
  "synthesis": "...",
  "keyInsights": ["insight 1", "insight 2", ...]
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
              content: 'You are helping me write my personal research journal. Write in first person from my perspective (use "I", "my research", "I found", etc.). Be direct and insightful like a seasoned CHI paper author. Respond with valid JSON only.',
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

      const entry: JournalEntry = {
        id: uuidv4(),
        date: dateStr,
        paperIds: datePapers.map(p => p.id),
        synthesis: parsed.synthesis || '',
        keyInsights: parsed.keyInsights || [],
        isGenerated: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await addJournalEntry(entry);
      setJournalEntries(prev => new Map(prev).set(dateStr, entry));
    } catch (error) {
      console.error('Error generating journal entry:', error);
      alert('Failed to generate entry. Please try again.');
    } finally {
      setGeneratingDate(null);
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
      keyInsights: editingInsights.filter(i => i.trim()),
      updatedAt: new Date(),
    };

    await updateJournalEntry(updated);
    setJournalEntries(prev => new Map(prev).set(editingDate, updated));
    setEditingDate(null);
  };

  const cancelEditing = () => {
    setEditingDate(null);
    setEditingSynthesis('');
    setEditingInsights([]);
  };

  const updateInsight = (index: number, value: string) => {
    const newInsights = [...editingInsights];
    newInsights[index] = value;
    setEditingInsights(newInsights);
  };

  const addInsight = () => {
    setEditingInsights([...editingInsights, '']);
  };

  const removeInsight = (index: number) => {
    setEditingInsights(editingInsights.filter((_, i) => i !== index));
  };

  // Group papers by date
  const papersByDate = groupPapersByDate(papers);
  const sortedDates = Array.from(papersByDate.keys()).sort((a, b) => b.localeCompare(a));

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
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">Journal</h1>
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
            <h2 className="text-lg font-medium text-[var(--text-secondary)] mb-2">No reading history yet</h2>
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
                    <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] border-2 border-[var(--border-default)] flex items-center justify-center z-10">
                      <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                    </div>
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
                          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <FileText className="w-3 h-3" />
                          <span className="truncate max-w-[200px]">{paper.title}</span>
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
                              {editingInsights.map((insight, idx) => (
                                <div key={idx} className="flex items-start gap-2">
                                  <span className="text-[var(--text-muted)] mt-2">•</span>
                                  <input
                                    type="text"
                                    value={insight}
                                    onChange={(e) => updateInsight(idx, e.target.value)}
                                    className="flex-1 text-sm p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)]"
                                  />
                                  <button
                                    onClick={() => removeInsight(idx)}
                                    className="p-2 text-[var(--text-muted)] hover:text-red-500 transition-colors"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
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
                            <p className="text-sm text-[var(--text-primary)] leading-relaxed flex-1">
                              {entry.synthesis}
                            </p>
                            <button
                              onClick={() => startEditing(entry)}
                              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors ml-4 flex-shrink-0"
                              title="Edit entry"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          </div>

                          {entry.keyInsights.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-[var(--border-default)]">
                              <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-3 uppercase tracking-wide">
                                Key Insights
                              </h4>
                              <ul className="space-y-2">
                                {entry.keyInsights.map((insight, idx) => (
                                  <li key={idx} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                                    <span className="text-[var(--accent-primary)] mt-0.5">•</span>
                                    <span>{insight}</span>
                                  </li>
                                ))}
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

