// Vercel Edge Function for OpenAI API calls
// The API key is stored as an environment variable on Vercel (OPENAI_API_KEY)
// Users never see or need to provide the key

export const config = {
  runtime: 'edge',
};

interface RequestBody {
  action: 'autofill' | 'summarize' | 'chat';
  content: string;
  researchContext?: string;
}

export default async function handler(req: Request) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: RequestBody = await req.json();
    const { action, content, researchContext } = body;

    let systemPrompt = '';
    let userPrompt = content;

    switch (action) {
      case 'autofill':
        systemPrompt = `You are a research assistant helping to extract key information from academic papers.
${researchContext ? `The user's research context: ${researchContext}` : ''}

Extract and return the following information in JSON format:
- methodology: The research methodology used (1-2 sentences)
- conclusion: The main conclusions of the paper (1-2 sentences)
- limitation: Key limitations mentioned (1-2 sentences)
- notes: Relevant insights for the user's research (1-2 sentences)

Return ONLY valid JSON with these fields.`;
        break;

      case 'summarize':
        systemPrompt = `You are a research assistant. Summarize the following text concisely, focusing on key findings and implications.
${researchContext ? `Consider the user's research context: ${researchContext}` : ''}`;
        break;

      case 'chat':
        systemPrompt = `You are a helpful research assistant with expertise in academic papers and research methodology.
${researchContext ? `The user's research context: ${researchContext}` : ''}
Provide clear, concise, and academically rigorous responses.`;
        break;

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('OpenAI API error:', error);
      return new Response(JSON.stringify({ error: 'OpenAI API error', details: error }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content || '';

    // For autofill, try to parse as JSON
    if (action === 'autofill') {
      try {
        const parsed = JSON.parse(result);
        return new Response(JSON.stringify(parsed), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        // If parsing fails, return the raw result
        return new Response(JSON.stringify({ raw: result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error processing request:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
