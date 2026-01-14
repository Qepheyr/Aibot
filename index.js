require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ==========================================
// 1. ⚙️ CONFIGURATION BLOCK
// ==========================================

const BOT_TOKEN = process.env.BOT_TOKEN || "8387077251:AAEgvuXxCWiXt8SKBgHVkHVmD4O6bZxdiac";
const GEMINI_KEY = process.env.GEMINI_KEY || "AIzaSyC5PL0nqKgrMRbFVwmfybOLAdI0-HIcrjY";
const ADMIN_ID = process.env.ADMIN_ID || "8435248854";

// Global State
let isAdminOnly = true;        
let customFooter = "";         
let adminState = null;         

const bot = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

// ==========================================
// 2. 🚫 BLACKLIST & FILTERS
// ==========================================

const GLOBAL_BLACKLIST = [
    "CODE", "GIFT", "PROMO", "PROMOCODE", "LINK", "CLICK", "HERE", "JOIN", 
    "PROOF", "PROOFS", "SEND", "BOT", "CHANNEL", "REGISTER", "LOGIN", 
    "SIGNUP", "BONUS", "WITHDRAW", "LOOT", "APP", "GAME", "WIN", "PLAY",
    "TODAY", "NEW", "BIG", "BEST", "FAST", "CLAIM", "UPTO", "VERIFIED",
    "AGENT", "COM", "ME", "NET", "ORG", "INFO", "RANDOM", "DAILY", 
    "REWARD", "MIN", "MAX", "DEPOSIT", "CONTACT", "SERVICE", "SUPPORT", 
    "TELEGRAM", "WHATSAPP", "AMOUNT", "BALANCE", "SUCCESS", "FAILED"
];

// ==========================================
// 3. 🧠 AI PROMPT BLOCK
// ==========================================

async function runAI_Extraction(rawText) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro"});
        
        const prompt = `
        ROLE: Data Extraction Specialist.
        TASK: Analyze text to extract 'App Names' and 'Promo Codes'.

        INPUT TEXT: 
        """
        ${rawText}
        """

        INSTRUCTIONS:
        1. **App Name**: Extract the name (e.g., "SpinWinner", "Diwa777"). 
           - Remove emojis and words like "Loot", "Offer".
           - If unknown, use "Exclusive Loot".

        2. **Code Extraction**:
           - **URLS**: If text has 'spinwinner.com?code=XYZ', extract 'XYZ'.
           - **DOMAINS**: If text has 'Code: spinwinner.com', extract 'spinwinner.com' (System will clean .com later).
           - **PATTERNS**: Look for "Code: ABC", "Gift >> 123", or standalone strings "DIWA555".
           
        3. **Cleanup**:
           - Do NOT extract timestamps ("173600...").
           - Do NOT extract generic words ("Verified", "Proof").

        4. **Format**: Return JSON Array.
        [ { "appName": "Name", "codes": ["Code1", "Code2"] } ]
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        const jsonMatch = text.match(/\[[\s\S]*\]/); 
        if (!jsonMatch) return null;
        
        return JSON.parse(jsonMatch[0]);

    } catch (error) {
        console.error("AI Logic Error:", error.message);
        return null;
    }
}

// ==========================================
// 4. 🛠️ MANUAL FALLBACK BLOCK
// ==========================================

function runManual_Extraction(text) {
    let codes = [];
    let appName = "Exclusive Loot";

    // A. App Name
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length > 0) {
        let cleanHeader = lines[0].replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '');
        cleanHeader = cleanHeader.replace(/New|Promo|Code|Loot|Gift|Offer|Big|Win|👇|🔥/gi, '').trim();
        let words = cleanHeader.split(/[\s-]+/);
        if (words.length > 0) appName = words[0]; 
    }

    // B. URL Parameter (e.g., ?code=XYZ)
    const urlParams = /[?&](?:code|invite|refer|referral|bonus_code)=([a-zA-Z0-9]+)/gi;
    let urlMatch;
    while ((urlMatch = urlParams.exec(text)) !== null) {
        if (urlMatch[1]) codes.push(urlMatch[1]);
    }

    // C. Keywords (Code: XYZ)
    const keywordRegex = /(?:Code|Gift|Promo|Loot|Bonus|Pin)\s*[:\->>»=]+\s*([a-zA-Z0-9@#&.]+)/gi; // Added . to allow domains temporarily
    let keyMatch;
    while ((keyMatch = keywordRegex.exec(text)) !== null) {
        if (keyMatch[1] && !keyMatch[1].startsWith('http')) codes.push(keyMatch[1]);
    }

    // D. Standalone Strings
    const complexRegex = /\b[A-Za-z0-9]{4,30}\b/g;
    let wordMatch;
    while ((wordMatch = complexRegex.exec(text)) !== null) {
        codes.push(wordMatch[0]);
    }

    return [{ appName, codes: [...new Set(codes)] }];
}

// ==========================================
// 5. 🧼 SANITIZER & VALIDATOR BLOCK (NEW!)
// ==========================================

// 🔥 NEW: Removes .com, .in, etc. from codes
function sanitizeCode(rawCode) {
    if (!rawCode) return "";
    let clean = rawCode.trim();
    
    // Remove domain extensions
    clean = clean.replace(/\.com|\.in|\.me|\.org|\.net|\.xyz|\.online/gi, "");
    
    // Remove common URL clutter
    clean = clean.replace(/https?:\/\/|www\./gi, "");
    
    return clean;
}

function validateCode(code, currentAppName) {
    if (!code) return false;
    let upper = code.toUpperCase();

    // RULE 1: Length
    if (code.length < 3 || code.length > 40) return false;

    // RULE 2: Blacklist
    if (GLOBAL_BLACKLIST.includes(upper)) return false;

    // RULE 3: Structure (Must not look like a full link anymore)
    if (code.match(/http|www|&t=|&dl=|%|@|\/\//)) return false;

    // RULE 4: Timestamps
    if (code.match(/^(16|17)\d{8}$/)) return false;

    // RULE 5: Numeric Prices (100, 200, 500)
    if (code.match(/^\d+$/)) {
        if (["100", "200", "500", "1000"].includes(code)) return false;
    }

    return true;
}

// ==========================================
// 6. 🛡️ BOT COMMANDS
// ==========================================

bot.command('end', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    adminState = 'AWAITING_FOOTER';
    ctx.reply("📝 **Footer Setup Mode**\nSend the text now.", { parse_mode: 'Markdown' });
});

bot.command('clear_end', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    customFooter = "";
    ctx.reply("🗑 Footer deleted.", { parse_mode: 'Markdown' });
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

bot.start((ctx) => ctx.reply("👋 **Ready!** I now auto-clean .com from codes."));

// ==========================================
// 7. 📨 MESSAGE PROCESSING
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
                return ctx.reply("✅ Footer Updated!");
            }
        }

        if (isAdminOnly && !isAdmin) return ctx.reply("⛔ Admin Access Only.");

        const text = ctx.message.text || ctx.message.caption;
        if (!text || text.startsWith('/')) return;

        const processingMsg = await ctx.reply("⏳ *Smart Scan...*", { parse_mode: 'Markdown' });

        // Step 1: Extract (AI or Manual)
        let results = await runAI_Extraction(text);
        if (!results || results.length === 0) {
            results = runManual_Extraction(text);
        }

        // Step 2: Clean & Validate
        let finalOutput = [];
        
        if (results && results.length > 0) {
            results.forEach(app => {
                let validCodes = [];
                if (app.codes && Array.isArray(app.codes)) {
                    app.codes.forEach(rawCode => {
                        // A. SANITIZE (Remove .com)
                        let clean = sanitizeCode(rawCode);
                        
                        // B. VALIDATE (Check if remaining text is good)
                        if (validateCode(clean, app.appName)) {
                            validCodes.push(clean);
                        }
                    });
                }
                
                if (validCodes.length > 0) {
                    finalOutput.push({
                        appName: app.appName || "Exclusive Loot",
                        codes: [...new Set(validCodes)]
                    });
                }
            });
        }

        try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch(e) {}

        if (finalOutput.length === 0) {
            return ctx.reply("❌ **No Valid Codes Found.**");
        }

        // Step 3: Send
        for (const item of finalOutput) {
            let formattedMsg = `<b>🎊 NEW LOOT FOR ${item.appName.toUpperCase()} 🎊</b>\n\n`;
            formattedMsg += `🔥 <b>App Name:</b> ${item.appName}\n`;
            formattedMsg += `➖➖➖➖➖➖➖➖➖➖\n\n`;
            
            item.codes.forEach((code, index) => {
                formattedMsg += `🎁 <b>Code ${index + 1}:</b> <code>${code}</code>\n`;
            });

            formattedMsg += `\n➖➖➖➖➖➖➖➖➖➖\n`;
            formattedMsg += `<i>⚡️ Click on any code to copy!</i>\n\n`;
            
            if (customFooter) formattedMsg += `<b>${customFooter}</b>`;

            await ctx.reply(formattedMsg, { parse_mode: 'HTML' });
            await new Promise(r => setTimeout(r, 400));
        }

    } catch (e) {
        console.error("ERROR:", e);
        ctx.reply("⚠️ Error.");
    }
});

bot.launch().then(() => console.log("✅ BOT ONLINE"));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
