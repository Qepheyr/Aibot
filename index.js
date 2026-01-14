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
// 🧠 AI ENGINE: MULTI-APP SPLITTER
// ==========================================

async function extractCodesWithAI(rawText) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro"});
        
        // 🔥 PROMPT: Designed to split text into multiple apps if needed
        const prompt = `
        You are an advanced Data Extractor.
        Analyze the text below. It might contain promo codes for ONE app, or MULTIPLE different apps.

        INPUT TEXT: 
        "${rawText}"

        YOUR TASK:
        Return a JSON ARRAY of objects. Each object represents one App and its codes.

        RULES:
        1. **Split Apps**: If the text says "IN7 Code: A" and "IE777 Code: B", create TWO objects.
        2. **App Name**: Extract from the line near the code. If unknown, use "Exclusive Loot".
        3. **Codes**: Extract all codes associated with that specific app.
           - Handle simple codes (e.g. "5858")
           - Handle complex codes (e.g. "DIWA777xfhj...")
           - Ignore links, prices, and dates.
        4. **Single App**: If only one app is found, return an array with just one object.

        REQUIRED JSON FORMAT (Array):
        [
          { "appName": "App Name 1", "codes": ["CodeA", "CodeB"] },
          { "appName": "App Name 2", "codes": ["CodeC"] }
        ]
        
        Return ONLY valid JSON. No Markdown.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Safe JSON Parse
        const jsonMatch = text.match(/\[[\s\S]*\]/); // Look for Array [...]
        if (!jsonMatch) return null;
        
        return JSON.parse(jsonMatch[0]);

    } catch (error) {
        console.error("AI Error:", error.message);
        return null;
    }
}

// ==========================================
// 🕵️‍♂️ MANUAL FALLBACK (Simple Safety Net)
// ==========================================

function manualExtract(text) {
    // Note: Manual fallback is dumb; it assumes only 1 app exists. 
    // It's a last resort if AI crashes.
    let codes = [];
    let appName = "Exclusive Loot";

    // 1. App Name (First non-emoji word)
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length > 0) {
        let cleanLine = lines[0].replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '');
        let words = cleanLine.split(' ');
        if (words.length > 0) appName = words.slice(0, 2).join(' ').replace(/[^a-zA-Z0-9]/g, '');
    }

    // 2. Code Extraction Regex
    const regex = /(?:Code|Gift|Promo|Loot|Bonus|Pin|Redeem)\s*[:\->>»=]+\s*([a-zA-Z0-9@#&]+)/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match[1] && match[1].length > 2 && !match[1].includes('http')) {
            codes.push(match[1]);
        }
    }
    
    // 3. Fallback for standalone strings (like DIWA777...)
    if (codes.length === 0) {
        const complexRegex = /\b[A-Za-z0-9@#&]{5,25}\b/g; 
        let cMatch;
        while ((cMatch = complexRegex.exec(text)) !== null) {
            let s = cMatch[0];
            if (!s.startsWith('http') && !s.includes('.com') && isNaN(s)) codes.push(s);
        }
    }

    // Return as an ARRAY to match AI format
    return [{ appName, codes }];
}

// ==========================================
// 🛡️ COMMANDS
// ==========================================

bot.command('end', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    adminState = 'AWAITING_FOOTER';
    ctx.reply("📝 **Set Footer Text**\nSend the text now.", { parse_mode: 'Markdown' });
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

bot.start((ctx) => ctx.reply("👋 **Ready!** Forward me any message.\nI can handle multiple apps in one message!"));

// ==========================================
// 📩 MESSAGE HANDLER
// ==========================================

bot.on('message', async (ctx) => {
    try {
        const userId = String(ctx.from.id);
        const isAdmin = userId === String(ADMIN_ID);

        // Footer Setup
        if (isAdmin && adminState === 'AWAITING_FOOTER') {
            if (ctx.message.text) {
                customFooter = ctx.message.text;
                adminState = null;
                return ctx.reply("✅ Footer Saved!");
            }
        }

        // Check Permissions
        if (isAdminOnly && !isAdmin) return ctx.reply("⛔ Access Denied.");

        // Get Text
        const text = ctx.message.text || ctx.message.caption;
        if (!text || text.startsWith('/')) return;

        const processingMsg = await ctx.reply("⏳ *Scanning...*", { parse_mode: 'Markdown' });

        // --- 🚀 EXECUTE SCAN ---
        let results = await extractCodesWithAI(text);

        // Fallback if AI fails completely
        if (!results || results.length === 0) {
            console.log("⚠️ AI failed, using Manual Fallback.");
            results = manualExtract(text);
        }
        
        try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch(e) {}

        // --- 📤 SEND MESSAGES (Loop through results) ---
        
        // Filter out items with no codes
        const validResults = results.filter(item => item.codes && item.codes.length > 0);

        if (validResults.length === 0) {
            return ctx.reply("❌ **No Codes Found.**");
        }

        // Send a separate message for EACH app found
        for (const item of validResults) {
            
            // 1. Clean Duplicate Codes (Set)
            const uniqueCodes = [...new Set(item.codes)];
            
            // 2. Format App Name
            const appName = item.appName || "Exclusive Loot";

            // 3. Build Message
            let formattedMsg = `<b>🎊 NEW LOOT FOR ${appName.toUpperCase()} 🎊</b>\n\n`;
            formattedMsg += `🔥 <b>App Name:</b> ${appName}\n`;
            formattedMsg += `➖➖➖➖➖➖➖➖➖➖\n\n`;
            
            uniqueCodes.forEach((code, index) => {
                formattedMsg += `🎁 <b>Code ${index + 1}:</b> <code>${code}</code>\n`;
            });

            formattedMsg += `\n➖➖➖➖➖➖➖➖➖➖\n`;
            formattedMsg += `<i>⚡️ Click on any code to copy!</i>\n\n`;
            
            if (customFooter) formattedMsg += `<b>${customFooter}</b>`;

            // 4. Send
            await ctx.reply(formattedMsg, { parse_mode: 'HTML' });
            
            // Small delay between messages to prevent flooding issues
            await new Promise(r => setTimeout(r, 500)); 
        }

    } catch (e) {
        console.error("Bot Error:", e);
        ctx.reply("⚠️ Critical Error.");
    }
});

// Launch
bot.launch().then(() => console.log("✅ Multi-App Bot Online"));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
