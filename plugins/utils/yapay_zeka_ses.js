const axios = require("axios");
const FormData = require("form-data");
const { withRetry } = require('./hata_yonetimi');

const VOICES = Object.freeze([
  "nova",
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "onyx",
  "sage",
  "shimmer",
]);

function getVoice(voice) {
  if (!voice) return "coral";
  const v = voice.toLowerCase();
  return VOICES.includes(v) ? v : "coral";
}

async function aiTTS(text, voice = "coral", speed = "1.00") {
  if (!text) return { error: "Metin sağlanmadı" };
  const selectedVoice = getVoice(voice);
  const formData = new FormData();
  formData.append("msg", text);
  formData.append("lang", selectedVoice);
  formData.append("speed", speed);
  formData.append("source", "ttsmp3");

  const fetchTTS = async () => {
    const { data } = await axios.post(
      "https://ttsmp3.com/makemp3_ai.php",
      formData,
      { headers: formData.getHeaders(), timeout: 15000 }
    );
    if (data?.Error === "Usage Limit exceeded") {
      throw new Error("Usage Limit exceeded");
    }
    if (data?.Error === 0 && data?.URL) {
      return { url: data.URL };
    }
    throw new Error("TTS oluşturma başarısız");
  };

  try {
    return await withRetry(fetchTTS, {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 5000
    });
  } catch (error) {
    if (error.message === "Usage Limit exceeded") {
       return { error: "TTS API kullanım limiti aşıldı" };
    }
    return { error: error.message };
  }
}

module.exports = aiTTS;
