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
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", fs.createReadStream(filePath));
    const response = await axios.post("https://catbox.moe/user/api.php", form, {
      headers: form.getHeaders(),
    });
    return { url: response.data.trim() };
  } catch (error) {
    console.error("Dosya Catbox'a yüklenemedi:", error.message);
    return { url: "_Dosya Catbox'a yüklenirken hata oluştu._" };
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
