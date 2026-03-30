import 'dotenv/config';

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  const endpoint = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;

  try {
    const resp = await fetch(endpoint);
    const data = await resp.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to list models:', err);
  }
}

listModels();
