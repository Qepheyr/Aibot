require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ==========================================
// ⚙️ CONFIGURATION & CREDENTIALS
// ==========================================

// 1. We look for variables from Railway first.
// 2. If not found, we fallback to the keys you provided (For ease of use).
const BOT_TOKEN = process.env.BOT_TOKEN || "8387077251:AAEgvuXxCWiXt8SKBgHVkHVmD4O6bZxdiac";
const GEMINI_KEY = process.env.GEMINI_KEY || "AIzaSyC5PL0nqKgrMRbFVwmfybOLAdI0-HIcrjY";
const ADMIN_ID = process.env.ADMIN_ID || "8435248854";

// SETTING: Default Mode (true = Admin Only, false = All Users)
let isAdminOnly = true; 

// Initialize
const bot = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

// ==========================================
// 🧠 AI EXTRACTION ENGINE
// ==========================================

async function extractCodesWithAI(rawText) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro"});
        const prompt = `
        You are a data extraction bot.
        Extract the 'App Name' and 'Promo Codes' from the text below.
        
        Text: "${rawText}"
        
        Rules:
        1. Return ONLY raw JSON. No markdown formatting (no \`\`\`).
        2. JSON Format: {"appName": "Name Here", "codes": ["Code1", "Code2"]}
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

bot.command('public', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    isAdminOnly = false;
    ctx.reply("🔓 **Bot is now PUBLIC.**\nEveryone can use it.", { parse_mode: 'Markdown' });
});

bot.command('private', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    isAdminOnly = true;
    ctx.reply("bf **Bot is now PRIVATE.**\nOnly Admins can use it.", { parse_mode: 'Markdown' });
});

bot.command('status', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    ctx.reply(`⚙️ **Current Status:**\nMode: ${isAdminOnly ? '🔒 Admin Only' : '🌍 Public'}`);
});

bot.start((ctx) => {
    ctx.reply("👋 **Hello!**\nForward a promo message to me, and I will extract the codes.\n\n_Admin commands: /public, /private_", { parse_mode: 'Markdown' });
});

// ==========================================
// 📩 MESSAGE HANDLER
// ==========================================

bot.on('message', async (ctx) => {
    try {
        const userId = String(ctx.from.id);
        const isAdmin = userId === String(ADMIN_ID);

        // 1. Check Access Permission
        if (isAdminOnly && !isAdmin) {
            return ctx.reply("⛔ **Access Denied.** This bot is currently set to Admin-Only mode.");
        }

        // 2. Get Text
        const text = ctx.message.text || ctx.message.caption;
        if (!text || text.startsWith('/')) return;

        // 3. Status Message
        const processingMsg = await ctx.reply("⏳ *Analyzing with AI...*", { parse_mode: 'Markdown' });

        // 4. AI Process
        const data = await extractCodesWithAI(text);

        // Delete status message
        try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch(e) {}

        // 5. Validation
        if (!data || !data.appName || !data.codes || data.codes.length === 0) {
            return ctx.reply("❌ **AI Failed:** No valid codes found in that message.");
        }

        // 6. Format & Send
        let formattedMsg = `<b>🎊 NEW LOOT FOR ${data.appName.toUpperCase()} 🎊</b>\n\n`;
        formattedMsg += `🔥 <b>App Name:</b> ${data.appName}\n`;
        formattedMsg += `➖➖➖➖➖➖➖➖➖➖\n\n`;
        
        data.codes.forEach((code, index) => {
            formattedMsg += `🎁 <b>Code ${index + 1}:</b> <code>${code}</code>\n`;
        });

        formattedMsg += `\n➖➖➖➖➖➖➖➖➖➖\n`;
        formattedMsg += `<i>⚡️ Click on any code to copy!</i>`;

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

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
