/**
 * Utility to interact with Google Gemini AI API
 */

const getGeminiResponse = async (prompt, systemPrompt, retries = 5) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY is not set in .env');
        return null;
    }

    // Try using v1 instead of v1beta for potentially better stability
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: {
                        parts: [{ text: systemPrompt || "You are LankaBot, a professional AI assistant." }]
                    },
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });

            const data = await response.json();
            
            if (response.ok) {
                if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
                    return data.candidates[0].content.parts[0].text;
                }
            }

            if (response.status === 429 || response.status === 503) {
                const waitTime = (i + 1) * 2000; // Increased delay: 2s, 4s, 6s...
                console.warn(`Gemini API Busy (${response.status}). Retrying in ${waitTime/1000}s... (${i + 1}/${retries})`);
                await new Promise(res => setTimeout(res, waitTime));
                continue;
            }

            console.error('Gemini API Error:', JSON.stringify(data));
            break; 
        } catch (error) {
            console.error('Error calling Gemini API:', error);
            await new Promise(res => setTimeout(res, 2000));
        }
    }

    // Ultimate fallback if AI fails completely
    return "I'm receiving too many messages right now and my AI engine is a bit overwhelmed. 😅 Please try again in a moment!";
};

module.exports = { getGeminiResponse };
