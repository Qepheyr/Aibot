require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ==========================================
// ⚙️ CONFIGURATION & CREDENTIALS
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
// 🧠 HYBRID EXTRACTION ENGINE
// ==========================================

// 1. MANUAL FALLBACK (The Safety Net)
// If AI fails, this math-based logic forces extraction
function manualExtract(text) {
    let codes = [];
    let appName = "Loot App";

    // A. Try to find App Name (First line usually)
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length > 0) {
        // Take first 3 words of first line as tentative app name
        let firstLineWords = lines[0].replace(/[^a-zA-Z0-9 ]/g, '').split(' ');
        if (firstLineWords.length > 0) appName = firstLineWords.slice(0, 3).join(' ');
    }

    // B. Aggressive Regex to find codes
    // Looks for: "Code : value", "Code >> value", "Code-value", "Code value"
    const regex = /(?:Code|Gift|Promo|Loot|Bonus|Pin|Pass|Redeem)\s*[:\->>»=]+\s*([a-zA-Z0-9@#]+)/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match[1] && match[1].length > 2) {
            codes.push(match[1]);
        }
    }

    // C. If keywords failed, look for isolated 4-8 digit numbers (common in these apps)
    if (codes.length === 0) {
        const numberRegex = /\b\d{4,8}\b/g;
        let numMatch;
        while ((numMatch = numberRegex.exec(text)) !== null) {
            codes.push(numMatch[0]);
        }
    }

    return { appName, codes: [...new Set(codes)] }; // Remove duplicates
}

// 2. MAIN AI FUNCTION
async function extractCodesWithAI(rawText) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro"});
        
        // 🔥 SUPER AGGRESSIVE PROMPT
        const prompt = `
        Act as a regex parser. Extract 'App Name' and 'Promo Codes' from this messy text.
        
        INPUT: "${rawText}"
        
        INSTRUCTIONS:
        1. App Name: Usually the first 1-3 words (e.g., "11Win", "Exploit Bit", "Diwa").
        2. Codes: ANYTHING that looks like a value after keywords like "Code", "Gift", ">>", ":", or simple numbers like "5858" or words like "hello".
        3. BE AGGRESSIVE. If you see "Code: hello", extract "hello". If you see "Gift Code >> 5858", extract "5858".
        
        Return JSON ONLY: {"appName": "Name", "codes": ["Code1", "Code2"]}
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Robust JSON Cleanup (Finds the {...} block even if AI adds extra text)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found");
        
        return JSON.parse(jsonMatch[0]);

    } catch (error) {
        console.error("AI Error (Switching to Manual):", error.message);
        return null; // Return null to trigger manual fallback
    }
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

bot.start((ctx) => ctx.reply("👋 **Ready!** Forward me any message.\nAdmin: /end, /public, /private"));

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

        const processingMsg = await ctx.reply("⏳ *Extracting...*", { parse_mode: 'Markdown' });

        // --- 🚀 HYBRID LOGIC START ---
        
        // Step 1: Try AI
        let data = await extractCodesWithAI(text);

        // Step 2: If AI failed or found 0 codes, use Manual Regex
        if (!data || !data.codes || data.codes.length === 0) {
            console.log("⚠️ AI failed, using Manual Regex.");
            data = manualExtract(text);
        }
        
        // --- 🚀 HYBRID LOGIC END ---

        try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch(e) {}

        // Final Validation
        if (!data || !data.codes || data.codes.length === 0) {
            return ctx.reply("❌ **Failed.**\nI couldn't find any code in that message even with manual search.");
        }

        // Format Message
        let formattedMsg = `<b>🎊 NEW LOOT FOR ${data.appName.toUpperCase()} 🎊</b>\n\n`;
        formattedMsg += `🔥 <b>App Name:</b> ${data.appName}\n`;
        formattedMsg += `➖➖➖➖➖➖➖➖➖➖\n\n`;
        
        data.codes.forEach((code, index) => {
            formattedMsg += `🎁 <b>Code ${index + 1}:</b> <code>${code}</code>\n`;
        });

        formattedMsg += `\n➖➖➖➖➖➖➖➖➖➖\n`;
        formattedMsg += `<i>⚡️ Click on any code to copy!</i>\n\n`;
        
        if (customFooter) formattedMsg += `<b>${customFooter}</b>`;

        await ctx.reply(formattedMsg, { parse_mode: 'HTML' });

    } catch (e) {
        console.error("Bot Error:", e);
        ctx.reply("⚠️ Critical Error.");
    }
});

// Launch
bot.launch().then(() => console.log("✅ Hybrid Bot Online"));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
