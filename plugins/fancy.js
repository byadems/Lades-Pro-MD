const { Module } = require('../main');
const isPrivateMode = require('../config').isPrivate;
const { fancy } = require('./utils');
Module({
     pattern: 'fancy ?(.*)',
     fromMe: isPrivateMode,
     use: 'edit',
     desc: 'Süslü metin yazı tipleri oluşturur'
 }, (async (message, match) => {
     if (!match[1] && !message.reply_message.message) return await message.sendReply('_*💬 Bir metni yanıtlayıp sayısal kodu belirtin veya direkt yazın.* Örnek:_\n\n- `.fancy 10 Merhaba`\n- `.fancy Merhaba dünya`\n'+String.fromCharCode(8206).repeat(4001)+fancy.list('Örnek metin',fancy));
    const id = match[1].match(/\d/g)?.join('')
     try {
        if (id === undefined && !message.reply_message){
            return await message.sendReply(fancy.list(match[1],fancy));
        }
        return await message.sendReply(fancy.apply(fancy[parseInt(id)-1],message.reply_message.text || match[1].replace(id,'')))    
    } catch {
        return await message.sendReply('_❌ Böyle bir stil yok!_')
     }
 }));