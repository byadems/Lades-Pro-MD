const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

const IMGBB_BASE_URL = "https://imgbb.com/";
const IMGBB_UPLOAD_URL = "https://imgbb.com/json";
const IMGBB_LIMIT = 33554432;
const CATBOX_LIMIT = 209715200;

const uploadToCatbox = async (filePath) => {
  try {
    const fileStats = await fs.promises.stat(filePath);
    if (fileStats.size > CATBOX_LIMIT) {
      return { url: "_Dosya boyutu 200MB sınırını aşıyor._" };
    }

    const upload = async (provider) => {
      const form = new FormData();
      if (provider === 'uguu') {
        form.append("files[]", fs.createReadStream(filePath));
        const res = await axios.post("https://uguu.se/upload", form, {
          headers: { ...form.getHeaders() },
          timeout: 60000
        });
        if (res.data && res.data.success && res.data.files && res.data.files[0]) {
          return res.data.files[0].url;
        }
        throw new Error("Uguu.se yükleme başarısız.");
      } else if (provider === 'catbox') {
        form.append("reqtype", "fileupload");
        form.append("fileToUpload", fs.createReadStream(filePath));
        const res = await axios.post("https://catbox.moe/user/api.php", form, {
          headers: {
            ...form.getHeaders(),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 60000
        });
        return res.data.trim();
      } else if (provider === 'quax') {
        form.append("files[]", fs.createReadStream(filePath));
        const res = await axios.post("https://qu.ax/upload.php", form, {
          headers: {
            ...form.getHeaders(),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 60000
        });
        if (res.data && res.data.success && res.data.files && res.data.files[0]) {
          return res.data.files[0].url;
        }
        throw new Error("Quax yükleme başarısız.");
      } else if (provider === 'sndup') {
        const path = require("path");
        const ext = path.extname(filePath).toLowerCase();
        if (![".mp3", ".ogg", ".wav", ".m4a"].includes(ext)) {
          throw new Error("SndUp sadece ses dosyalarını destekler.");
        }
        form.append("file", fs.createReadStream(filePath));
        const res = await axios.post("https://www.sndup.net/post.php", form, {
          headers: {
            ...form.getHeaders(),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 60000
        });
        if (res.data && res.data.url) {
          return res.data.url;
        }
        throw new Error("SndUp yükleme başarısız.");
      }
    };

    const providers = ['uguu', 'catbox', 'quax', 'sndup'];
    let lastError;

    for (const provider of providers) {
      try {
        const url = await upload(provider);
        if (url && url.startsWith('http')) return { url };
      } catch (e) {
        lastError = e.message;
        console.warn(`${provider} başarısız:`, e.message);
      }
    }
    
    return { url: `_Yükleme başarısız: ${lastError}_` };
  } catch (error) {
    console.error("Dosya yüklenemedi:", error.message);
    return { url: "_Dosya yüklenirken kritik hata oluştu._" };
  }
};

const fetchAuthToken = async () => {
  try {
    const response = await axios.get(IMGBB_BASE_URL);
    const authTokenMatch = response.data.match(
      /PF\.obj\.config\.auth_token="([a-f0-9]{40})"/
    );

    if (authTokenMatch && authTokenMatch[1]) {
      return authTokenMatch[1];
    }
    throw new Error("Kimlik doğrulama anahtarı bulunamadı.");
  } catch (error) {
    console.error("Kimlik doğrulama anahtarı alınamadı:", error.message);
    throw error;
  }
};

const uploadToImgbb = async (imagePath) => {
  try {
    const fileStats = await fs.promises.stat(imagePath);

    if (fileStats.size > IMGBB_LIMIT) {
      return { url: "_Dosya boyutu 32MB sınırını aşıyor._" };
    }

    const authToken = await fetchAuthToken();
    const formData = new FormData();

    formData.append("source", fs.createReadStream(imagePath));
    formData.append("type", "file");
    formData.append("action", "upload");
    formData.append("timestamp", Date.now());
    formData.append("auth_token", authToken);

    const response = await axios.post(IMGBB_UPLOAD_URL, formData, {
      headers: { ...formData.getHeaders() },
    });

    if (response.data) {
      return response.data.image;
    } else {
      return { error: "Yükleme başarısız, yanıt verisi yok." };
    }
  } catch (error) {
    console.error("Dosya yüklenemedi:", error.message);
    return { error: error.message };
  }
};

module.exports = {
  uploadToImgbb,
  uploadToCatbox,
};
