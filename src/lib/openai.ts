// OpenAI API helper
// In production: calls /api/openai (Vercel Edge Function)
// In development: calls OpenAI directly using VITE_OPENAI_API_KEY from .env.local

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
}

interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

const isDev = import.meta.env.DEV;
const devApiKey = import.meta.env.VITE_OPENAI_API_KEY;

export async function callOpenAI(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  // In development with API key available, call OpenAI directly
  if (isDev && devApiKey) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${devApiKey}`,
      },
      body: JSON.stringify({
        model: request.model || 'gpt-4o-mini',
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.max_tokens || 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
    }

    return response.json();
  }

  // In production (or dev without key), call our API endpoint
  const response = await fetch('/api/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    // Check if it's a 404 (API not available in dev)
    if (response.status === 404 && isDev) {
      throw new Error(
        'API not available. For local development, either:\n' +
        '1. Add VITE_OPENAI_API_KEY to .env.local\n' +
        '2. Run "npx vercel dev" instead of "npm run dev"'
      );
    }
    
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`API error: ${error.error || 'Unknown error'}`);
  }

  return response.json();
}
