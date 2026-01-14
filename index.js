require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ==========================================
// ⚙️ CONFIGURATION & CREDENTIALS
// ==========================================

// Railway Variables (Fallbacks provided for your ease, but using Envs is safer)
const BOT_TOKEN = process.env.BOT_TOKEN || "8387077251:AAEgvuXxCWiXt8SKBgHVkHVmD4O6bZxdiac";
const GEMINI_KEY = process.env.GEMINI_KEY || "AIzaSyC5PL0nqKgrMRbFVwmfybOLAdI0-HIcrjY";
const ADMIN_ID = process.env.ADMIN_ID || "8435248854";

// SETTINGS
let isAdminOnly = true;        // Default: Admin Only
let customFooter = "";         // Stores your custom end message
let adminState = null;         // Tracks if bot is waiting for input (like footer text)

const bot = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

// ==========================================
// 🧠 UNIVERSAL AI ENGINE (Enhanced)
// ==========================================

async function extractCodesWithAI(rawText) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro"});
        
        // 🔥 UPGRADED PROMPT with "Search by Own" logic
        const prompt = `
        You are an advanced 'Promo Code Extractor' bot.
        Read the text (English/Hindi/Hinglish) and extract data intelligenty.

        INPUT TEXT: 
        "${rawText}"

        YOUR TASK:
        1. **App Name**: Identify the app/game name. (Usually near start, or before words like "App", "Game").
        2. **Codes**: Identify ALL codes using your judgment.
           - Look for keywords like: "Code", "Gift Code", "Promo", "Redeem", "Code >>", "Code :", "Code lelo", "Ye raha code", etc.
           - **IMPORTANT:** Even if no keywords are present, look for standalone patterns that look like codes (e.g., "5858", "DIWA123", "XY-99"). Use your understanding of loot/promo messages to find them.

        RULES:
        - Extract messy codes (e.g. from "code is 5555" -> "5555").
        - Output MUST be in English.
        - Return ONLY raw JSON. No markdown.

        JSON FORMAT:
        {"appName": "Name_In_English", "codes": ["Code1", "Code2"]}
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Clean up markdown if AI adds it
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);

    } catch (error) {
        console.error("AI Error:", error);
        return null;
    }
}

// ==========================================
// 🛡️ ADMIN COMMANDS
// ==========================================

// 1. Footer Setup Command
bot.command('end', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    adminState = 'AWAITING_FOOTER';
    ctx.reply("📝 **Set Footer Text**\n\nSend the text (or link) you want to appear at the bottom of every message.\n\n_Example: Join @MyChannel for more!_", { parse_mode: 'Markdown' });
});

bot.command('clear_end', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    customFooter = "";
    ctx.reply("🗑 Footer removed.", { parse_mode: 'Markdown' });
});

// 2. Mode Toggles
bot.command('public', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    isAdminOnly = false;
    ctx.reply("🔓 **Bot is Public.**", { parse_mode: 'Markdown' });
});

bot.command('private', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    isAdminOnly = true;
    ctx.reply("🔒 **Bot is Private.**", { parse_mode: 'Markdown' });
});

bot.start((ctx) => {
    ctx.reply("👋 **Ready!** Send me text to extract codes.\n\n**/end** - Set footer text\n**/public** - Allow everyone", { parse_mode: 'Markdown' });
});

// ==========================================
// 📩 MESSAGE HANDLER
// ==========================================

bot.on('message', async (ctx) => {
    try {
        const userId = String(ctx.from.id);
        const isAdmin = userId === String(ADMIN_ID);

        // --- HANDLER: SETTING FOOTER ---
        if (isAdmin && adminState === 'AWAITING_FOOTER') {
            const footerInput = ctx.message.text;
            if (footerInput) {
                customFooter = footerInput; // Save to variable
                adminState = null; // Reset state
                return ctx.reply(`✅ **Footer Saved!**\nIt will look like this:\n\n...Codes...\n➖➖➖➖\n${customFooter}`, { parse_mode: 'Markdown' });
            } else {
                return ctx.reply("❌ Please send text only.");
            }
        }

        // --- HANDLER: AI EXTRACTION ---
        
        // 1. Check Access
        if (isAdminOnly && !isAdmin) return ctx.reply("⛔ Access Denied.");

        // 2. Get Text
        const text = ctx.message.text || ctx.message.caption;
        if (!text || text.startsWith('/')) return;

        // 3. Status
        const processingMsg = await ctx.reply("⏳ *Analyzing...*", { parse_mode: 'Markdown' });

        // 4. AI Process
        const data = await extractCodesWithAI(text);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch(e) {}

        // 5. Validation
        if (!data || !data.appName || !data.codes || data.codes.length === 0) {
            return ctx.reply("❌ **No Codes Found.**\nTry adding keywords like 'Code:' to help the AI.");
        }

        // 6. Format Message
        let formattedMsg = `<b>🎊 NEW LOOT FOR ${data.appName.toUpperCase()} 🎊</b>\n\n`;
        formattedMsg += `🔥 <b>App Name:</b> ${data.appName}\n`;
        formattedMsg += `➖➖➖➖➖➖➖➖➖➖\n\n`;
        
        data.codes.forEach((code, index) => {
            formattedMsg += `🎁 <b>Code ${index + 1}:</b> <code>${code}</code>\n`;
        });

        formattedMsg += `\n➖➖➖➖➖➖➖➖➖➖\n`;
        formattedMsg += `<i>⚡️ Click on any code to copy!</i>\n\n`;
        
        // 7. Append Custom Footer (if set)
        if (customFooter) {
            formattedMsg += `<b>${customFooter}</b>`; // Adds your saved text
        }

        await ctx.reply(formattedMsg, { parse_mode: 'HTML' });

    } catch (e) {
        console.error("Bot Error:", e);
        ctx.reply("⚠️ Error: Something went wrong.");
    }
});

// ==========================================
// 🚀 LAUNCH
// ==========================================

bot.launch().then(() => {
    console.log("✅ Bot is online on Railway!");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
