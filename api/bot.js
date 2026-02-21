/**
 * Vercel Serverless Function: AI Study Agent (v3.0)
 * Features: Group Tagging, Private DM, & Inline Search Mode
 */

export default async function handler(req, res) {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const BOT_USERNAME = process.env.BOT_USERNAME;

    if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) return res.status(500).json({ error: "Missing Keys" });

    // WEBHOOK SETUP (GET)
    if (req.method === 'GET') {
        const host = req.headers.host;
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=https://${host}/api/bot`);
        const data = await response.json();
        return res.status(200).json(data);
    }

    // MESSAGE HANDLING (POST)
    if (req.method === 'POST') {
        const update = req.body;
        if (!update) return res.status(200).send('No body');

        // --- 1. HANDLE INLINE QUERIES (@botname query) ---
        if (update.inline_query) {
            const queryId = update.inline_query.id;
            const queryText = update.inline_query.query;

            if (queryText.length < 3) return res.status(200).send('Too short');

            try {
                // Generate a quick AI summary for inline result
                const ai = await getGeminiResponse(GEMINI_API_KEY, `Quick summary: ${queryText}`, true);
                
                await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerInlineQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        inline_query_id: queryId,
                        results: [{
                            type: 'article',
                            id: queryId,
                            title: `AI Explanation: ${queryText}`,
                            description: ai.text.substring(0, 100).replace(/<[^>]*>/g, ''), // Plain text for preview
                            input_message_content: {
                                message_text: `<b>Topic:</b> ${queryText}\n\n${ai.text}`,
                                parse_mode: 'HTML'
                            }
                        }],
                        cache_time: 300
                    })
                });
                return res.status(200).send('OK');
            } catch (e) { return res.status(200).send('Inline Error'); }
        }

        // --- 2. HANDLE STANDARD MESSAGES (DMs & Groups) ---
        const chatId = update.message?.chat.id || update.callback_query?.message.chat.id;
        const chatType = update.message?.chat.type || update.callback_query?.message.chat.type;
        let userText = update.message?.text || update.callback_query?.data;

        if (!chatId || !userText) return res.status(200).send('Ignored');

        // Group filtering: Only respond if tagged
        if ((chatType === 'group' || chatType === 'supergroup') && BOT_USERNAME) {
            if (!userText.includes(`@${BOT_USERNAME}`)) return res.status(200).send('Not tagged');
            userText = userText.replace(`@${BOT_USERNAME}`, '').trim();
        }

        try {
            await sendAction(TELEGRAM_TOKEN, chatId, 'typing');

            if (userText === '/start') {
                await sendTelegramMessage(TELEGRAM_TOKEN, chatId, 
                    "🧬 <b>Study Agent v3 Active</b>\n\nAsk me anything! In groups, tag me. To share answers, type <code>@fbastudybot</code> in any chat.",
                    ["Quick Quiz 🧠", "Math Help 📐"]
                );
                return res.status(200).send('OK');
            }

            const aiResponse = await getGeminiResponse(GEMINI_API_KEY, userText);
            await sendTelegramMessage(TELEGRAM_TOKEN, chatId, aiResponse.text, aiResponse.options);

        } catch (error) {
            console.error("Error:", error);
        }
        return res.status(200).send('OK');
    }
}

// --- AI BRAIN (Gemini 3 Flash) ---
async function getGeminiResponse(apiKey, prompt, isInline = false) {
    const MODEL = "gemma-3-27b-it"; 
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    
    const context = isInline ? "Give a concise 1-paragraph summary." : "You are an expert tutor for Class 8-10.";

    const body = {
        contents: [{ parts: [{ text: `${context} Query: "${prompt}". Return JSON: {"text": "...", "options": ["Topic1", "Topic2"]}` }] }]
    };

    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const data = await res.json();
    const raw = data.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
    
    try {
        return JSON.parse(raw);
    } catch (e) {
        return { text: raw, options: ["Help", "Menu"] };
    }
}

// --- TELEGRAM UTILS ---
async function sendTelegramMessage(token, chatId, text, buttons = []) {
    const keyboard = buttons.map(b => [{ text: b, callback_data: b }]);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId, text, parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        })
    });
}

async function sendAction(token, chatId, action) {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action })
    });
            }
