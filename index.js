
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
// 🧠 AI "DEEP SCAN" ENGINE
// ==========================================

async function extractCodesWithAI(rawText) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro"});
        
        // 🔥 UPGRADED "DEEP SCAN" PROMPT
        const prompt = `
        You are a Deep Scan Promo Detector. 
        Analyze the ENTIRE text below (Header, Body, Footer) to extract the 'App Name' and ALL 'Promo Codes'.

        INPUT TEXT: 
        "${rawText}"

        TASKS:
        1. **App Name**: 
           - Look at the very first line.
           - Look for words like "Club", "Win", "Bet", "Loot", "Mall", "Game".
           - Example: "11Win Loot" -> App Name is "11Win". "Diwa777 Code" -> App Name is "Diwa777".
           - If NO name is found, use "Exclusive Loot".

        2. **Codes (Extract ALL, from 1 to 10)**:
           - Look for explicit patterns: "Code: ABC", "Gift >> 1234", "Redeem - XYZ".
           - Look for implicit patterns: "hello" (if text says 'Code: hello'), "5858" (if text says 'Gift 5858').
           - Look for STANDALONE alphanumeric strings that look like codes (e.g., "DIWA500", "BONUS20").
           - Ignore links (http...), ignore prices (₹100).
        
        OUTPUT RULES:
        - Return ONLY valid JSON.
        - Format: {"appName": "Name Found", "codes": ["Code1", "Code2", "Code3"]}
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Safe JSON Clean & Parse
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        
        return JSON.parse(jsonMatch[0]);

    } catch (error) {
        console.error("AI Error:", error.message);
        return null;
    }
}

// ==========================================
// 🕵️‍♂️ MANUAL FALLBACK (Regex)
// ==========================================

function manualExtract(text) {
    let codes = [];
    let appName = "Exclusive Loot";

    // 1. Try to find App Name (First 2 words of first line)
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length > 0) {
        let firstLineClean = lines[0].replace(/[^a-zA-Z0-9 ]/g, '').trim();
        let words = firstLineClean.split(' ');
        if (words.length > 0) appName = words.slice(0, 2).join(' ');
    }

    // 2. Aggressive Regex for Codes
    // Captures: "Code: value", "Code >> value", "Code-value", "Code value"
    const keywordRegex = /(?:Code|Gift|Promo|Loot|Bonus|Pin|Pass|Redeem)\s*[:\->>»=]+\s*([a-zA-Z0-9@#]+)/gi;
    let match;
    while ((match = keywordRegex.exec(text)) !== null) {
        if (match[1] && match[1].length > 2 && !match[1].startsWith('http')) {
            codes.push(match[1]);
        }
    }

    // 3. Number Fallback (find 4-8 digit numbers if no keyword found)
    if (codes.length === 0) {
        const numRegex = /\b\d{4,8}\b/g;
        let numMatch;
        while ((numMatch = numRegex.exec(text)) !== null) {
            codes.push(numMatch[0]);
        }
    }

    return { appName, codes: [...new Set(codes)] };
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

bot.start((ctx) => ctx.reply("👋 **Ready!** Forward me any promo message."));

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

        const processingMsg = await ctx.reply("⏳ *Deep Scanning...*", { parse_mode: 'Markdown' });

        // --- 🚀 EXECUTE DEEP SCAN ---
        
        // 1. Try AI First
        let data = await extractCodesWithAI(text);

        // 2. If AI returns nothing or empty codes, use Manual
        if (!data || !data.codes || data.codes.length === 0) {
            console.log("⚠️ AI found nothing, switching to Regex.");
            data = manualExtract(text);
        }
        
        // --- 🚀 END SCAN ---

        try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch(e) {}

        // Final Check
        if (!data || !data.codes || data.codes.length === 0) {
            return ctx.reply("❌ **No Codes Found.**\nI scanned the whole text but couldn't find a valid code pattern.");
        }

        // Clean App Name (Fallback to 'Unknown' if empty)
        const displayAppName = (data.appName && data.appName !== "None") ? data.appName : "Exclusive Loot";

        // ==========================================
        // 🎨 BEAUTIFUL MESSAGE GENERATION
        // ==========================================
        
        let formattedMsg = `<b>🎊 NEW LOOT FOR ${displayAppName.toUpperCase()} 🎊</b>\n\n`;
        formattedMsg += `🔥 <b>App Name:</b> ${displayAppName}\n`;
        formattedMsg += `➖➖➖➖➖➖➖➖➖➖\n\n`;
        
        // Loop through ALL codes found
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
bot.launch().then(() => console.log("✅ Deep Scan Bot Online"));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
