require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ==========================================
// ⚙️ CONFIGURATION
// ==========================================

const BOT_TOKEN = process.env.BOT_TOKEN || "8387077251:AAEgvuXxCWiXt8SKBgHVkHVmD4O6bZxdiac";
const GEMINI_KEY = process.env.GEMINI_KEY || "AIzaSyC5PL0nqKgrMRbFVwmfybOLAdI0-HIcrjY";
const ADMIN_ID = process.env.ADMIN_ID || "8435248854";

// SETTINGS
let isAdminOnly = true;        
let customFooter = "";         
let adminState = null;         

const bot = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

// ==========================================
// 🧠 AI ENGINE: SMART & STRICT
// ==========================================

async function extractCodesWithAI(rawText) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro"});
        
        // 🔥 PROMPT: Added strict "Negative Constraints"
        const prompt = `
        You are an advanced Data Extractor.
        Analyze the text below. Extract App Names and Codes.

        INPUT TEXT: 
        "${rawText}"

        RULES:
        1. **App Name**: Extract the clean name. 
           - Remove emojis (😆Diwa777 -> Diwa777).
           - Remove versions/ordinals (Diwa777 4th -> Diwa777).
        
        2. **Codes**: Extract ACTUAL codes only.
           - **STRICTLY IGNORE** labels like: "Promocode", "Gift Code", "Link", "Proof", "Click", "Here", "Bonus", "Register".
           - **Example:** If text says "Big Promocode 👇👇 DIWA123", the code is "DIWA123", NOT "Promocode".
           - **Example:** If text says "Send Proofs @Bot", "Proofs" is NOT a code.
           - Codes are usually Uppercase, Alphanumeric, or Numbers (e.g., 5858, DIWA777xyz).

        3. **Multi-App**: If multiple apps exist, split them into the array.

        REQUIRED JSON FORMAT:
        [
          { "appName": "Name", "codes": ["Code1"] }
        ]
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        const jsonMatch = text.match(/\[[\s\S]*\]/); 
        if (!jsonMatch) return null;
        
        return JSON.parse(jsonMatch[0]);

    } catch (error) {
        console.error("AI Error:", error.message);
        return null;
    }
}

// ==========================================
// 🕵️‍♂️ MANUAL FALLBACK + FILTERING
// ==========================================

// 🚫 Words that are NEVER codes
const BLACKLIST = [
    "CODE", "GIFT", "PROMO", "PROMOCODE", "LINK", "CLICK", "HERE", "JOIN", 
    "PROOF", "PROOFS", "SEND", "BOT", "CHANNEL", "REGISTER", "LOGIN", 
    "SIGNUP", "BONUS", "WITHDRAW", "LOOT", "APP", "GAME", "WIN", "PLAY",
    "TODAY", "NEW", "BIG", "BEST", "FAST", "CLAIM"
];

function isCleanCode(code) {
    if (!code) return false;
    const upper = code.toUpperCase();
    
    // 1. Check Blacklist
    if (BLACKLIST.includes(upper)) return false;
    
    // 2. Check Valid Length (Codes usually 4-30 chars)
    if (code.length < 3 || code.length > 35) return false;

    // 3. Check for URL/Links
    if (code.includes('http') || code.includes('www') || code.includes('.com') || code.includes('.in')) return false;

    // 4. Check for strict non-code characters (like @ for usernames)
    if (code.startsWith('@')) return false;

    return true;
}

function manualExtract(text) {
    let codes = [];
    let appName = "Exclusive Loot";

    // 1. App Name (Remove Emojis and grab first word)
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length > 0) {
        let cleanLine = lines[0].replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '');
        // Remove common filler words from title line
        cleanLine = cleanLine.replace(/4th|3rd|Big|Loot|Promocode|Gift/gi, '').trim();
        let words = cleanLine.split(' ');
        if (words.length > 0) appName = words[0].replace(/[^a-zA-Z0-9]/g, '');
    }

    // 2. Extract Candidates
    const candidates = text.match(/\b[a-zA-Z0-9@#&]{4,30}\b/g) || [];
    
    // 3. Filter Candidates
    candidates.forEach(word => {
        if (isCleanCode(word)) {
            // Additional check: mostly numbers or uppercase mixed
            codes.push(word);
        }
    });

    return [{ appName, codes: [...new Set(codes)] }];
}

// ==========================================
// 🛡️ COMMANDS
// ==========================================

bot.command('end', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    adminState = 'AWAITING_FOOTER';
    ctx.reply("📝 **Set Footer Text**", { parse_mode: 'Markdown' });
});

bot.command('clear_end', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    customFooter = "";
    ctx.reply("🗑 Footer removed.", { parse_mode: 'Markdown' });
});

bot.command('public', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    isAdminOnly = false;
    ctx.reply("🔓 **Bot is Public.**");
});

bot.command('private', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    isAdminOnly = true;
    ctx.reply("🔒 **Bot is Private.**");
});

bot.start((ctx) => ctx.reply("👋 **Ready!** Forward me any promo message."));

// ==========================================
// 📩 MESSAGE HANDLER
// ==========================================

bot.on('message', async (ctx) => {
    try {
        const userId = String(ctx.from.id);
        const isAdmin = userId === String(ADMIN_ID);

        if (isAdmin && adminState === 'AWAITING_FOOTER') {
            if (ctx.message.text) {
                customFooter = ctx.message.text;
                adminState = null;
                return ctx.reply("✅ Footer Saved!");
            }
        }

        if (isAdminOnly && !isAdmin) return ctx.reply("⛔ Access Denied.");

        const text = ctx.message.text || ctx.message.caption;
        if (!text || text.startsWith('/')) return;

        const processingMsg = await ctx.reply("⏳ *Scanning...*", { parse_mode: 'Markdown' });

        // --- 🚀 SCAN ---
        let results = await extractCodesWithAI(text);
        if (!results || results.length === 0) results = manualExtract(text);
        
        try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch(e) {}

        // --- 🧹 CLEANING PHASE ---
        // Even if AI returns "Promocode" as a code, we filter it here manually
        const finalResults = results.map(item => {
            return {
                appName: item.appName,
                // Apply the isCleanCode filter to AI results too!
                codes: item.codes.filter(c => isCleanCode(c)) 
            };
        }).filter(item => item.codes.length > 0);

        if (finalResults.length === 0) {
            return ctx.reply("❌ **No Valid Codes Found.**");
        }

        // --- 📤 SEND MESSAGES ---
        for (const item of finalResults) {
            const uniqueCodes = [...new Set(item.codes)];
            const appName = item.appName || "Exclusive Loot";

            let formattedMsg = `<b>🎊 NEW LOOT FOR ${appName.toUpperCase()} 🎊</b>\n\n`;
            formattedMsg += `🔥 <b>App Name:</b> ${appName}\n`;
            formattedMsg += `➖➖➖➖➖➖➖➖➖➖\n\n`;
            
            uniqueCodes.forEach((code, index) => {
                formattedMsg += `🎁 <b>Code ${index + 1}:</b> <code>${code}</code>\n`;
            });

            formattedMsg += `\n➖➖➖➖➖➖➖➖➖➖\n`;
            formattedMsg += `<i>⚡️ Click on any code to copy!</i>\n\n`;
            
            if (customFooter) formattedMsg += `<b>${customFooter}</b>`;

            await ctx.reply(formattedMsg, { parse_mode: 'HTML' });
            await new Promise(r => setTimeout(r, 500)); 
        }

    } catch (e) {
        console.error("Bot Error:", e);
        ctx.reply("⚠️ Error.");
    }
});

bot.launch().then(() => console.log("✅ Fixed Bot Online"));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
