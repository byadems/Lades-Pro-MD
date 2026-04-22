const axios = require('axios');
const config = require('./config');

async function testGemini() {
  const apiKey = config.GEMINI_API_KEY;
  const models = [
    "gemini-3-flash-preview"
  ];
  const systemInstruction = {
    parts: [{ text: "Sen Lades'sin." }]
  };
  const contents = [{ role: "user", parts: [{ text: "Lütfen 1'den 100'e kadar olan sayıları ve ardından da bir matematik sorusu yaz." }] }];

  for (const model of models) {
    console.log(`\nTesting model: ${model}`);
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const response = await axios.post(apiUrl, {
        system_instruction: systemInstruction,
        contents,
        generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
      }, { timeout: 10000 });
      console.log('SUCCESS:', response.data.candidates[0].content.parts[0].text);
    } catch (err) {
      console.log('ERROR:', err.response ? JSON.stringify(err.response.data) : err.message);
    }
  }
}

testGemini();
