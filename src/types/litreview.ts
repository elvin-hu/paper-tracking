// Literature Review Spreadsheet Types
// This module is completely standalone and doesn't affect other parts of the app

export type LitReviewColumnType = 'text' | 'select' | 'multiselect' | 'number' | 'boolean';

export interface LitReviewColumnOption {
  id: string;
  label: string;
  color?: string;
}

export interface LitReviewColumn {
  id: string;
  name: string;
  type: LitReviewColumnType;
  description: string; // AI prompt describing what to extract
  options?: LitReviewColumnOption[]; // For select/multiselect
  width: number;
  isRequired?: boolean;
}

export interface LitReviewCell {
  value: string | string[] | number | boolean | null;
  confidence?: number; // 0-1 AI confidence score
  sourceText?: string; // Text excerpt used for extraction
  sourcePageNumber?: number;
}

export interface LitReviewRow {
  id: string;
  paperId: string;
  paperTitle: string;
  cells: Record<string, LitReviewCell>; // columnId -> cell
  status: 'pending' | 'processing' | 'completed' | 'error';
  errorMessage?: string;
  extractedAt?: Date;
}

export interface LitReviewVersion {
  id: string;
  name: string;
  createdAt: Date;
  columns: LitReviewColumn[];
  rows: LitReviewRow[];
}

export interface LitReviewSheet {
  id: string;
  projectId: string;
  name: string;
  columns: LitReviewColumn[];
  rows: LitReviewRow[];
  versions: LitReviewVersion[];
  currentVersionId?: string;
  selectedPaperIds: string[]; // Papers included in this sheet
  createdAt: Date;
  updatedAt: Date;
}

export interface LitReviewPreset {
  id: string;
  name: string;
  description?: string;
  columns: LitReviewColumn[];
}

// Default column presets for common literature review needs
export const DEFAULT_PRESETS: LitReviewPreset[] = [
  {
    id: 'hci-study',
    name: 'HCI Study Analysis',
    description: 'For analyzing HCI/CHI papers with user studies',
    columns: [
      {
        id: 'study-type',
        name: 'Study Type',
        type: 'select',
        description: 'What type of study was conducted? Look for methodology section.',
        options: [
          { id: 'lab', label: 'Lab Study', color: '#3b82f6' },
          { id: 'field', label: 'Field Study', color: '#10b981' },
          { id: 'survey', label: 'Survey', color: '#f59e0b' },
          { id: 'interview', label: 'Interview', color: '#8b5cf6' },
          { id: 'deployment', label: 'Deployment', color: '#ec4899' },
          { id: 'mixed', label: 'Mixed Methods', color: '#6366f1' },
          { id: 'other', label: 'Other', color: '#6b7280' },
        ],
        width: 140,
      },
      {
        id: 'participants',
        name: 'Participants (N)',
        type: 'number',
        description: 'How many participants were in the study? Look for N= or "participants" in methodology.',
        width: 120,
      },
      {
        id: 'population',
        name: 'Population',
        type: 'text',
        description: 'Who were the participants? (e.g., students, older adults, experts)',
        width: 180,
      },
      {
        id: 'system',
        name: 'System/Prototype',
        type: 'text',
        description: 'What system, tool, or prototype was built or evaluated?',
        width: 200,
      },
      {
        id: 'key-findings',
        name: 'Key Findings',
        type: 'text',
        description: 'What were the main findings or contributions? Summarize in 1-2 sentences.',
        width: 300,
      },
      {
        id: 'limitations',
        name: 'Limitations',
        type: 'text',
        description: 'What limitations did the authors mention?',
        width: 250,
      },
    ],
  },
  {
    id: 'systematic-review',
    name: 'Systematic Review',
    description: 'For conducting systematic literature reviews',
    columns: [
      {
        id: 'research-question',
        name: 'Research Question',
        type: 'text',
        description: 'What research question does this paper address?',
        width: 250,
      },
      {
        id: 'methodology',
        name: 'Methodology',
        type: 'text',
        description: 'What methodology or approach was used?',
        width: 200,
      },
      {
        id: 'sample-size',
        name: 'Sample Size',
        type: 'text',
        description: 'What was the sample size? Include units if applicable.',
        width: 120,
      },
      {
        id: 'data-collection',
        name: 'Data Collection',
        type: 'multiselect',
        description: 'How was data collected?',
        options: [
          { id: 'surveys', label: 'Surveys', color: '#3b82f6' },
          { id: 'interviews', label: 'Interviews', color: '#10b981' },
          { id: 'observations', label: 'Observations', color: '#f59e0b' },
          { id: 'logs', label: 'System Logs', color: '#8b5cf6' },
          { id: 'sensors', label: 'Sensors', color: '#ec4899' },
          { id: 'secondary', label: 'Secondary Data', color: '#6366f1' },
        ],
        width: 180,
      },
      {
        id: 'main-results',
        name: 'Main Results',
        type: 'text',
        description: 'What were the main results or findings?',
        width: 300,
      },
      {
        id: 'quality',
        name: 'Quality Assessment',
        type: 'select',
        description: 'Rate the methodological quality of this study.',
        options: [
          { id: 'high', label: 'High', color: '#10b981' },
          { id: 'medium', label: 'Medium', color: '#f59e0b' },
          { id: 'low', label: 'Low', color: '#ef4444' },
        ],
        width: 130,
      },
    ],
  },
  {
    id: 'design-space',
    name: 'Design Space Analysis',
    description: 'For mapping design spaces and comparing systems',
    columns: [
      {
        id: 'domain',
        name: 'Application Domain',
        type: 'text',
        description: 'What domain or context is this system designed for?',
        width: 180,
      },
      {
        id: 'input-modality',
        name: 'Input Modality',
        type: 'multiselect',
        description: 'What input modalities does the system support?',
        options: [
          { id: 'touch', label: 'Touch', color: '#3b82f6' },
          { id: 'voice', label: 'Voice', color: '#10b981' },
          { id: 'gesture', label: 'Gesture', color: '#f59e0b' },
          { id: 'gaze', label: 'Gaze', color: '#8b5cf6' },
          { id: 'keyboard', label: 'Keyboard/Mouse', color: '#6b7280' },
          { id: 'pen', label: 'Pen/Stylus', color: '#ec4899' },
        ],
        width: 180,
      },
      {
        id: 'output-modality',
        name: 'Output Modality',
        type: 'multiselect',
        description: 'What output modalities does the system use?',
        options: [
          { id: 'visual', label: 'Visual', color: '#3b82f6' },
          { id: 'audio', label: 'Audio', color: '#10b981' },
          { id: 'haptic', label: 'Haptic', color: '#f59e0b' },
          { id: 'ar', label: 'AR/VR', color: '#8b5cf6' },
        ],
        width: 180,
      },
      {
        id: 'key-technique',
        name: 'Key Technique',
        type: 'text',
        description: 'What is the key technical contribution or novel technique?',
        width: 250,
      },
      {
        id: 'evaluation',
        name: 'Evaluation Type',
        type: 'select',
        description: 'How was the system evaluated?',
        options: [
          { id: 'user-study', label: 'User Study', color: '#3b82f6' },
          { id: 'technical', label: 'Technical Evaluation', color: '#10b981' },
          { id: 'case-study', label: 'Case Study', color: '#f59e0b' },
          { id: 'none', label: 'No Formal Evaluation', color: '#6b7280' },
        ],
        width: 160,
      },
    ],
  },
];

// Storage key prefix for localStorage
export const LITREVIEW_STORAGE_KEY = 'litreview_sheets';
