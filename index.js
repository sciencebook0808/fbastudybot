/**
 * Vercel Serverless Function: AI Study Agent
 * Features: Group Tagging Logic & Private DM Support
 */

export default async function handler(req, res) {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const BOT_USERNAME = process.env.BOT_USERNAME; // Pulled from Vercel Env

    if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) {
        return res.status(500).json({ error: "Missing API Keys" });
    }

    // WEBHOOK SETUP ROUTE
    if (req.method === 'GET') {
        try {
            const host = req.headers.host;
            const setupUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=https://${host}/api/bot`;
            const response = await fetch(setupUrl);
            const data = await response.json();
            return res.status(200).json({ status: "Webhook Configured", details: data });
        } catch (error) {
            return res.status(500).json({ error: "Setup failed", details: error.message });
        }
    }

    // MESSAGE HANDLING ROUTE
    if (req.method === 'POST') {
        const update = req.body;
        if (!update) return res.status(200).send('No body');

        const chatId = update.message?.chat.id || update.callback_query?.message.chat.id;
        const chatType = update.message?.chat.type || update.callback_query?.message.chat.type;
        let userText = update.message?.text || update.callback_query?.data;

        if (!chatId || !userText) return res.status(200).send('Ignored');

        // --- GROUP CHAT LOGIC ---
        if (chatType === 'group' || chatType === 'supergroup') {
            // If the bot isn't tagged, ignore the message completely
            if (!BOT_USERNAME || !userText.includes(`@${BOT_USERNAME}`)) {
                return res.status(200).send('Ignored: Bot not tagged in group');
            }

            // Remove the bot's username from the text so the AI doesn't get confused
            userText = userText.replace(`@${BOT_USERNAME}`, '').trim();

            // If they just tagged the bot without asking anything
            if (userText === '') {
                await sendTelegramMessage(TELEGRAM_TOKEN, chatId, "Yes? How can I help you? 🤓");
                return res.status(200).send('OK');
            }
        }

        try {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, action: 'typing' })
            });

            // Handle Commands
            if (userText === '/start' || userText === `/start@${BOT_USERNAME}`) {
                await sendTelegramMessage(TELEGRAM_TOKEN, chatId, 
                    "🧬 <b>Welcome to the AI Study Hub!</b>\n\nI am your fast, background tutor. I can explain science, solve math, or create custom quizzes.\n\n<i>What are we learning today?</i>",
                    ["Class 10 Math 📐", "Physics Lab 🧪", "Quick Quiz 🧠"]
                );
                return res.status(200).send('OK');
            }

            // Fetch AI Response
            const aiResponse = await getGeminiResponse(GEMINI_API_KEY, userText);
            await sendTelegramMessage(TELEGRAM_TOKEN, chatId, aiResponse.text, aiResponse.options);

            return res.status(200).send('OK');

        } catch (error) {
            console.error("Bot Execution Error:", error);
            await sendTelegramMessage(TELEGRAM_TOKEN, chatId, 
                `⚠️ <b>System Alert</b>\nMy brain had a small hiccup.\n\n<i>Log: ${error.message}</i>`,
                ["Main Menu 🏠"]
            );
            return res.status(200).send('Error handled');
        }
    }

    return res.status(405).send('Method Not Allowed');
}

// --- AI BRAIN LOGIC ---
async function getGeminiResponse(apiKey, prompt) {
    const MODEL = "gemini-3-flash"; 
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    
    const systemPrompt = `
        You are a Class 8-10 Study Agent. User Query: "${prompt}"
        Rules:
        1. Keep it concise. Use HTML tags (<b>, <i>, <code>).
        2. ALWAYS return your output as a valid JSON object.
        3. Format: {"text": "your educational response", "options": ["Follow up 1", "Follow up 2"]}
    `;

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
    });

    if (!response.ok) throw new Error(`Gemini API Error: ${response.statusText}`);

    const data = await response.json();
    const rawText = data.candidates[0].content.parts[0].text;
    
    const cleanJsonString = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    try {
        return JSON.parse(cleanJsonString);
    } catch (parseError) {
        return {
            text: `<b>Here is what I found:</b>\n\n${rawText}`,
            options: ["Next Topic", "Main Menu 🏠"]
        };
    }
}

// --- TELEGRAM UI LOGIC ---
async function sendTelegramMessage(token, chatId, text, buttons = []) {
    const inlineKeyboard = [];
    
    if (buttons && buttons.length > 0) {
        for (let i = 0; i < buttons.length; i += 2) {
            const row = [{ text: buttons[i], callback_data: buttons[i] }];
            if (buttons[i + 1]) row.push({ text: buttons[i + 1], callback_data: buttons[i + 1] });
            inlineKeyboard.push(row);
        }
    }

    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineKeyboard }
    };

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}
