// Netlify Function: Canadian Grant Finder
// Keeps the Anthropic API key on the server. The browser sends only the
// founder's answers; the prompt is built here so the endpoint can't be used
// as a general-purpose proxy to the API.
//
// Required environment variable (Netlify > Site configuration > Environment variables):
//   ANTHROPIC_API_KEY   your key from console.anthropic.com
// Optional:
//   ANTHROPIC_MODEL     defaults to claude-sonnet-5-5

const ALLOWED = {
  stage: ['idea', 'mvp', 'scaling'],
  model: ['B2B', 'B2C', 'Nonprofit / Social enterprise', 'Mixed / Other'],
  industry: [
    'Technology / Software', 'AI / Machine learning', 'Cleantech / Environment',
    'Health / Life sciences', 'Agriculture / Food', 'Manufacturing',
    'Retail / E-commerce', 'Education', 'Social enterprise', 'Other',
  ],
  amount: ['under $25,000', '$25,000 to $100,000', '$100,000 to $500,000', 'over $500,000'],
  province: [
    'anywhere in Canada', 'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick',
    'Newfoundland and Labrador', 'Northwest Territories', 'Nova Scotia', 'Nunavut',
    'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Yukon',
  ],
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'Grant finder is not configured yet.' });

  let input;
  try {
    input = await req.json();
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  for (const [field, options] of Object.entries(ALLOWED)) {
    if (!options.includes(input?.[field])) {
      return json(400, { error: `Please choose a valid ${field}.` });
    }
  }
  const desc = String(input.desc || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const { stage, model, industry, amount, province } = input;

  const prompt = `You are a Canadian startup funding expert. A founder submitted this profile:
- Business stage: ${stage}
- Business model: ${model}
- Industry: ${industry}
- Funding needed: ${amount}
- Province / territory: ${province}
- Description: ${desc || 'Not provided'}

Return a JSON array of exactly 5 Canadian government grants or funding programs that best match this founder. Prioritize programs relevant to ${province} — include both federal programs AND provincial programs specific to ${province} where applicable. Use only real, well-known Canadian programs.

Each object must have:
- name: program name (string)
- org: administering organization (string)
- description: 1-2 sentence description (string)
- maxAmount: maximum funding as a string e.g. "Up to $50,000"
- type: one of "grant", "loan", "tax credit", "advisory"
- match: one of "high", "medium", "low"
- why: 1 sentence explaining specifically why this matches this founder
- tags: array of 2-3 short labels
- deadline: "Rolling intake" or a real date or "Varies — check website"

Respond with ONLY a valid JSON array, no markdown, no extra text.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('Anthropic API error', res.status, await res.text());
      return json(502, { error: 'The grant service is busy. Please try again in a moment.' });
    }

    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || '').join('');
    const match = text.replace(/```json|```/g, '').match(/\[[\s\S]*\]/);
    const grants = JSON.parse(match ? match[0] : text);
    if (!Array.isArray(grants)) throw new Error('Response was not an array');

    return json(200, { grants: grants.slice(0, 5) });
  } catch (err) {
    console.error('Grant finder failed', err);
    return json(500, { error: 'Something went wrong fetching results. Please try again.' });
  }
};

export const config = { path: '/api/grant-finder' };
