// Vercel serverless function — /api/generate
// Keeps your Gemini API key on the server. The browser never sees it.
// Set GEMINI_API_KEY as an environment variable in your Vercel project settings.
// Gemini's free tier needs no credit card — see README for how to get a key.

const MODEL = 'gemini-2.5-flash';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY. Set it in your hosting provider\'s environment variables.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { action, text, sourceText, title, count } = body || {};

  try {
    if (action === 'summary') {
      const prompt = buildSummaryPrompt(text, title);
      const result = await callGemini(apiKey, prompt, 8192, false);
      return res.status(200).json({ text: result });
    }

    if (action === 'quiz') {
      const n = Math.min(30, Math.max(20, parseInt(count, 10) || 25));
      const prompt = buildQuizPrompt(text, sourceText, n);
      const raw = await callGemini(apiKey, prompt, 16384, true);
      const questions = parseQuizJson(raw);
      return res.status(200).json({ questions });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Generation failed' });
  }
};

async function callGemini(apiKey, prompt, maxTokens, wantJson) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const generationConfig = { maxOutputTokens: maxTokens, temperature: 0.5 };
  if (wantJson) generationConfig.responseMimeType = 'application/json';

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig
    })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error('Gemini API error (' + resp.status + '): ' + errText.slice(0, 300));
  }
  const data = await resp.json();
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error('Gemini returned no content (it may have blocked the response).');
  if (candidate.finishReason === 'MAX_TOKENS' && (!candidate.content || !candidate.content.parts)) {
    throw new Error('Response was cut off before finishing — try again, or ask for fewer questions.');
  }
  const parts = (candidate.content && candidate.content.parts) || [];
  return parts.map(p => p.text || '').join('\n').trim();
}

function buildSummaryPrompt(sourceText, title) {
  return `You are an expert study assistant helping a student turn raw lecture notes into a thorough, well-organized study summary they can actually learn from.

Lecture/topic title: ${title || '(untitled)'}

RAW NOTES:
"""
${sourceText}
"""

Write a DETAILED, well-structured summary in Markdown. Requirements:
- Start with a short "Key Takeaways" section (4-8 bullets) capturing the absolute must-knows.
- Then organize the rest of the material under clear "## " headings that mirror the actual structure/topics of the notes — do not skip sections, do not over-compress. This should be detailed enough to substitute for re-reading the original notes, not a shallow overview.
- Preserve all important definitions, formulas, dates, names, numbers, processes, and examples exactly as given — do not invent facts that are not in the notes.
- Use bold for key terms, and bullet or numbered lists for sequences, steps, or comparisons.
- If the notes include formulas or equations, keep them precise and clearly labeled.
- End with a short "Common pitfalls / things to double-check" section if the material has any error-prone concepts, based only on what's in the notes.
- Do not add a generic introduction or conclusion paragraph — get straight into the content.
- Respond with ONLY the Markdown content, nothing else.`;
}

function buildQuizPrompt(summaryText, sourceText, count) {
  return `You are writing a practice quiz for a student based on their lecture notes.

SUMMARY:
"""
${summaryText}
"""

${sourceText ? `ORIGINAL RAW NOTES (for extra detail/context):\n"""\n${sourceText}\n"""\n` : ''}

Write exactly ${count} multiple-choice questions that thoroughly test understanding of this material — cover the full breadth of the content (not just the first section), mix difficulty levels (some recall, some applied/conceptual), and avoid trivial or ambiguous questions.

Respond with ONLY a raw JSON array (no markdown fences, no commentary, no leading/trailing text) in exactly this shape:
[
  {
    "question": "string",
    "options": ["string", "string", "string", "string"],
    "correctIndex": 0,
    "explanation": "one or two sentences explaining why the correct answer is right"
  }
]
Each question must have exactly 4 options and exactly one correct answer. Make sure correctIndex is a 0-based index into options.`;
}

function parseQuizJson(raw) {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('Model did not return a JSON array of questions.');
  return parsed;
}
