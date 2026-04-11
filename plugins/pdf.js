const { Module } = require("../main");
const fileSystem = require("node:fs/promises");
const fileType = require("file-type");
const path = require("path");
const fs = require("fs");
const { getTempSubdir, getTempPath } = require("../core/helpers");

const getFileType = async (buffer) => {
  try {
    if (fileType.fileTypeFromBuffer) {
      return await fileType.fileTypeFromBuffer(buffer);
    }

    if (fileType.fromBuffer) {
      return await fileType.fromBuffer(buffer);
    }

    return await fileType(buffer);
  } catch (error) {
    console.log("Dosya türü algılanamadı:", error);
    return null;
  }
};

const imageInputDirectory = getTempSubdir("pdf");
const finalPdfOutputPath = getTempPath("converted.pdf");

Module({
    pattern: "pdf ?(.*)",
    fromMe: false,
    desc: "Seçtiğiniz veya yanıtladığınız görselleri tek bir PDF belgesi haline getirir.",
    usage: ".pdf | .pdf getir | .pdf sil",
  },
  async (message, commandArguments) => {
    const subCommand = commandArguments[1]?.toLowerCase();

    if (subCommand === "yardım") {
      await message.sendReply(`_🗑️ 1. .pdf ile resimleri ekleyin_\n_2. .pdf getir ile PDF çıktısını alın_\n_3. Yanlışlıkla resim mi eklediniz? .pdf sil ile geri alın._\n_Çıktı alındıktan sonra tüm dosyalar otomatik silinir_`
      );
    } else if (subCommand === "sil") {
      const currentFiles = await fileSystem.readdir(imageInputDirectory);
      const filesToDelete = currentFiles.map((fileName) =>
        path.join(imageInputDirectory, fileName)
      );

      await Promise.all(
        filesToDelete.map((filePath) => fileSystem.unlink(filePath))
      );

      try {
        await fileSystem.unlink(finalPdfOutputPath);
      } catch (error) { }
      await message.sendReply(`_✅ Tüm dosyalar başarıyla temizlendi!_`);
    } else if (subCommand === "getir") {
      const allStoredFiles = await fileSystem.readdir(imageInputDirectory);
      const imageFilePaths = allStoredFiles
        .filter((fileName) => fileName.includes("topdf"))
        .map((fileName) => path.join(imageInputDirectory, fileName));

      if (!imageFilePaths.length) {
        return await message.sendReply("_💬 Dosya girişi yapılmadı!_");
      }

      try {
        const { PDFDocument } = require('pdf-lib');
        const pdfDoc = await PDFDocument.create();

        for (const imgPath of imageFilePaths) {
          const imgBytes = await fileSystem.readFile(imgPath);
          let image;
          if (imgPath.toLowerCase().endsWith('.png')) {
            image = await pdfDoc.embedPng(imgBytes);
          } else {
            image = await pdfDoc.embedJpg(imgBytes);
          }
          const { width, height } = image.scale(1);
          const page = pdfDoc.addPage([width, height]);
          page.drawImage(image, { x: 0, y: 0, width, height });
        }

        const pdfBytes = await pdfDoc.save();
        await fileSystem.writeFile(finalPdfOutputPath, pdfBytes);

        await message.client.sendMessage(
          message.jid,
          {
            document: { url: finalPdfOutputPath },
            mimetype: "application/pdf",
            fileName: "converted.pdf",
          },
          { quoted: message.data }
        );

        const filesToCleanUp = await fileSystem.readdir(imageInputDirectory);
        const tempFilesForDeletion = filesToCleanUp.map((fileName) =>
          path.join(imageInputDirectory, fileName)
        );
        await Promise.all(
          tempFilesForDeletion.map((filePath) => fileSystem.unlink(filePath))
        );
        await fileSystem.unlink(finalPdfOutputPath);
      } catch (error) {
        await message.sendReply(`_PDF dönüşümü başarısız: ${error.message}_`);
      }
    } else if (message.reply_message && message.reply_message.album) {
      // handle album
      const albumData = await message.reply_message.download();
      const allImages = albumData.images || [];

      if (allImages.length === 0)
        return await message.sendReply("_🎬 Albümde resim yok! (videolar PDF'ye dönüştürülemez)_");

      await message.send(
        `_${allImages.length} albüm görseli PDF'e ekleniyor..._`
      );

      for (let i = 0; i < allImages.length; i++) {
        try {
          const file = allImages[i];
          const detectedFileType = await getFileType(
            await fileSystem.readFile(file)
          );

          if (detectedFileType && detectedFileType.mime.startsWith("image")) {
            const newImagePath = path.join(
              imageInputDirectory,
              `topdf_album_${i}.jpg`
            );
            await fileSystem.copyFile(file, newImagePath);
          }
        } catch (err) {
          console.error("Albüm görseli PDF'e eklenemedi:", err);
        }
      }

      await message.sendReply(
        `_*✅ ${allImages.length} albüm görseli kaydedildi*_\n_*Tüm görseller hazır. PDF oluşturmak için '.pdf getir' yazın!*_`
      );
    } else if (message.reply_message) {
      const repliedMessageBuffer = await message.reply_message.download(
        "buffer"
      );
      const detectedFileType = await getFileType(repliedMessageBuffer);

      if (detectedFileType && detectedFileType.mime.startsWith("image")) {
        const existingImageFiles = (
          await fileSystem.readdir(imageInputDirectory)
        ).filter((fileName) => fileName.includes("topdf"));
        const nextImageIndex = existingImageFiles.length;
        const newImagePath = path.join(
          imageInputDirectory,
          `topdf_${nextImageIndex}.jpg`
        );

        await fileSystem.writeFile(newImagePath, repliedMessageBuffer);
        return await message.sendReply(
          `*_Görsel başarıyla kaydedildi_*\n_*Toplam kaydedilen görsel: ${nextImageIndex + 1
          }*_\n*_Tüm görselleri kaydettikten sonra sonucu almak için '.pdf getir' yazın. Dönüştürmeden sonra görseller silinecektir!_*`
        );
      } else {
        return await message.sendReply("_💬 PDF dönüşümüne eklemek için bir resme yanıtlayın!_"
        );
      }
    } else {
      return await message.sendReply('_💬 Bir resme yanıtlayın veya daha fazla bilgi için ".pdf yardım" yazın._'
      );
    }
  }
);
