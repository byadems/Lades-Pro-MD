const {
	Function,
	Fancy,
	styletext,
	isPublic
} = require('../lib/');
Function({
	pattern: 'fancy ?(.*)',
	fromMe: isPublic,
	desc: 'change text font to fancy font',
	type: 'misc'
}, async (m, text, client) => {
	if (!m.match[0] && !m.quoted) return await m.reply("*Reply to a message*\n\nExample: .fancy 32\nNumber codes:\n\n1. ᖴᗩᘉᑢᖻ ᖶᘿ᙭ᖶ\n2. fคຖ¢ฯ tēxt\n3. ʄąŋƈყ ɬɛҳɬ\n4. ｷﾑ刀ᄃﾘ ｲ乇ﾒｲ\n5. 千卂几匚ㄚ ㄒ乇乂ㄒ\n6. 🄵🄰🄽🄲🅈 🅃🄴🅇🅃\n7. ᎦᏗᏁፈᎩ ᏖᏋጀᏖ\n8. ᖴᗩᑎᑕY TE᙭T\n9. ʄǟռƈʏ ȶɛӼȶ\n10. 𝙵𝚊𝚗𝚌𝚢 𝚃𝚎𝚡𝚝\n11. 𝙁𝙖𝙣𝙘𝙮 𝙏𝙚𝙭𝙩\n12. 𝐅𝐚𝐧𝐜𝐲 𝐓𝐞𝐱𝐭\n13. 𝗙𝗮𝗻𝗰𝘆 𝗧𝗲𝘅𝘁\n14. 𝘍𝘢𝘯𝘤𝘺 𝘛𝘦𝘹𝘵\n15. Fαɳƈყ Tҽxƚ\n16. ₣₳₦₵Ɏ ₮ɆӾ₮\n17. £åñ¢¥ †êx†\n18. ƒαη¢у тєχт\n19. Ƒąղçվ Ͳҽ×է\n20. FΛПᄃY ƬΣXƬ\n21. Fₐₙcy ₜₑₓₜ\n22. ᶠᵃⁿᶜʸ ᵀᵉˣᵗ\n23. Ŧคภςץ ՇєאՇ\n24. 𝔽𝕒𝕟𝕔𝕪 𝕋𝕖𝕩𝕥\n25. 𝕱𝖆𝖓𝖈𝖞 𝕿𝖊𝖝𝖙\n26. 🅵🅰🅽🅲🆈 🆃🅴🆇🆃\n27. 𝓕𝓪𝓷𝓬𝔂 𝓣𝓮𝔁𝓽\n28. 𝔉𝔞𝔫𝔠𝔶 𝔗𝔢𝔵𝔱\n29. Ｆａｎｃｙ Ｔｅｘｔ\n30. 𝑭𝒂𝒏𝒄𝒚 𝑻𝒆𝒙𝒕\n31. 𝐹𝛥𝛮𝐶𝑌 𝑇𝛯𝛸𝑇\n32. Fᴀɴᴄʏ Tᴇxᴛ\n33. 𝙁𝞓𝞜𝘾𝙔 𝙏𝞢𝞦𝙏\n34. 𝐅𝚫𝚴𝐂𝐘 𝚻𝚵𝚾𝚻\n35. ᖴᗩᑎᑕᎩ Ꭲᗴ᙭Ꭲ\n36. ᠻꪖꪀᥴꪗ 𝓽ꫀ᥊𝓽");
	v = parseInt(m.match[0]) + 1
	if (!Number(m.match[0])) return await m.reply("*The fancy number code must be a number!*\n\nExample: .fancy 32\nNumber codes:\n\n1. ᖴᗩᘉᑢᖻ ᖶᘿ᙭ᖶ\n2. fคຖ¢ฯ tēxt\n3. ʄąŋƈყ ɬɛҳɬ\n4. ｷﾑ刀ᄃﾘ ｲ乇ﾒｲ\n5. 千卂几匚ㄚ ㄒ乇乂ㄒ\n6. 🄵🄰🄽🄲🅈 🅃🄴🅇🅃\n7. ᎦᏗᏁፈᎩ ᏖᏋጀᏖ\n8. ᖴᗩᑎᑕY TE᙭T\n9. ʄǟռƈʏ ȶɛӼȶ\n10. 𝙵𝚊𝚗𝚌𝚢 𝚃𝚎𝚡𝚝\n11. 𝙁𝙖𝙣𝙘𝙮 𝙏𝙚𝙭𝙩\n12. 𝐅𝐚𝐧𝐜𝐲 𝐓𝐞𝐱𝐭\n13. 𝗙𝗮𝗻𝗰𝘆 𝗧𝗲𝘅𝘁\n14. 𝘍𝘢𝘯𝘤𝘺 𝘛𝘦𝘹𝘵\n15. Fαɳƈყ Tҽxƚ\n16. ₣₳₦₵Ɏ ₮ɆӾ₮\n17. £åñ¢¥ †êx†\n18. ƒαη¢у тєχт\n19. Ƒąղçվ Ͳҽ×է\n20. FΛПᄃY ƬΣXƬ\n21. Fₐₙcy ₜₑₓₜ\n22. ᶠᵃⁿᶜʸ ᵀᵉˣᵗ\n23. Ŧคภςץ ՇєאՇ\n24. 𝔽𝕒𝕟𝕔𝕪 𝕋𝕖𝕩𝕥\n25. 𝕱𝖆𝖓𝖈𝖞 𝕿𝖊𝖝𝖙\n26. 🅵🅰🅽🅲🆈 🆃🅴🆇🆃\n27. 𝓕𝓪𝓷𝓬𝔂 𝓣𝓮𝔁𝓽\n28. 𝔉𝔞𝔫𝔠𝔶 𝔗𝔢𝔵𝔱\n29. Ｆａｎｃｙ Ｔｅｘｔ\n30. 𝑭𝒂𝒏𝒄𝒚 𝑻𝒆𝒙𝒕\n31. 𝐹𝛥𝛮𝐶𝑌 𝑇𝛯𝛸𝑇\n32. Fᴀɴᴄʏ Tᴇxᴛ\n33. 𝙁𝞓𝞜𝘾𝙔 𝙏𝞢𝞦𝙏\n34. 𝐅𝚫𝚴𝐂𝐘 𝚻𝚵𝚾𝚻\n35. ᖴᗩᑎᑕᎩ Ꭲᗴ᙭Ꭲ\n36. ᠻꪖꪀᥴꪗ 𝓽ꫀ᥊𝓽");
	if (v > 37) return await m.reply("*invalid number code*\n*please use the correct number code*\n\nExample: .fancy 32\nNumber codes:\n\n1. ᖴᗩᘉᑢᖻ ᖶᘿ᙭ᖶ\n2. fคຖ¢ฯ tēxt\n3. ʄąŋƈყ ɬɛҳɬ\n4. ｷﾑ刀ᄃﾘ ｲ乇ﾒｲ\n5. 千卂几匚ㄚ ㄒ乇乂ㄒ\n6. 🄵🄰🄽🄲🅈 🅃🄴🅇🅃\n7. ᎦᏗᏁፈᎩ ᏖᏋጀᏖ\n8. ᖴᗩᑎᑕY TE᙭T\n9. ʄǟռƈʏ ȶɛӼȶ\n10. 𝙵𝚊𝚗𝚌𝚢 𝚃𝚎𝚡𝚝\n11. 𝙁𝙖𝙣𝙘𝙮 𝙏𝙚𝙭𝙩\n12. 𝐅𝐚𝐧𝐜𝐲 𝐓𝐞𝐱𝐭\n13. 𝗙𝗮𝗻𝗰𝘆 𝗧𝗲𝘅𝘁\n14. 𝘍𝘢𝘯𝘤𝘺 𝘛𝘦𝘹𝘵\n15. Fαɳƈყ Tҽxƚ\n16. ₣₳₦₵Ɏ ₮ɆӾ₮\n17. £åñ¢¥ †êx†\n18. ƒαη¢у тєχт\n19. Ƒąղçվ Ͳҽ×է\n20. FΛПᄃY ƬΣXƬ\n21. Fₐₙcy ₜₑₓₜ\n22. ᶠᵃⁿᶜʸ ᵀᵉˣᵗ\n23. Ŧคภςץ ՇєאՇ\n24. 𝔽𝕒𝕟𝕔𝕪 𝕋𝕖𝕩𝕥\n25. 𝕱𝖆𝖓𝖈𝖞 𝕿𝖊𝖝𝖙\n26. 🅵🅰🅽🅲🆈 🆃🅴🆇🆃\n27. 𝓕𝓪𝓷𝓬𝔂 𝓣𝓮𝔁𝓽\n28. 𝔉𝔞𝔫𝔠𝔶 𝔗𝔢𝔵𝔱\n29. Ｆａｎｃｙ Ｔｅｘｔ\n30. 𝑭𝒂𝒏𝒄𝒚 𝑻𝒆𝒙𝒕\n31. 𝐹𝛥𝛮𝐶𝑌 𝑇𝛯𝛸𝑇\n32. Fᴀɴᴄʏ Tᴇxᴛ\n33. 𝙁𝞓𝞜𝘾𝙔 𝙏𝞢𝞦𝙏\n34. 𝐅𝚫𝚴𝐂𝐘 𝚻𝚵𝚾𝚻\n35. ᖴᗩᑎᑕᎩ Ꭲᗴ᙭Ꭲ\n36. ᠻꪖꪀᥴꪗ 𝓽ꫀ᥊𝓽");
	const match = m.quoted ? m.quoted.text || m.quoted.data.message.hydratedFourRowTemplate.hydratedContentText : text.trim().split(/ +/).slice(1).join(" ");
	await m.reply(await Fancy(match, m.match[0]))
})
Function({
	pattern: 'styletext ?(.*)',
	fromMe: isPublic,
	desc: 'change text to styletext',
	type: 'misc'
}, async (m, match) => {
	if (!match && !m.quoted.text) return await m.reply('_Need Text_\n*Example* : styletext Hermit')
	match = m.quoted ? m.quoted.text || m.quoted.data.message.hydratedFourRowTemplate.hydratedContentText : match;
	const res = await styletext(match)
	let text = ''
	let no = 1
	for (let i of res) {
		text += `${no++}. ${i.result}\n\n`
	}
	await m.reply(text)
})