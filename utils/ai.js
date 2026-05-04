/**
 * Utility to interact with Google Gemini AI API
 */

const getGeminiResponse = async (prompt, systemPrompt, retries = 5) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY is not set in .env');
        return null;
    }

    // Switch back to v1beta which is more feature-rich for Gemini Flash
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

    for (let i = 0; i < retries; i++) {
        try {
            // Combine system prompt and user prompt for better compatibility across API versions
            const combinedPrompt = systemPrompt 
                ? `System Instruction: ${systemPrompt}\n\nUser Message: ${prompt}`
                : prompt;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ 
                        parts: [{ text: combinedPrompt }] 
                    }]
                })
            });

            const data = await response.json();
            
            if (response.ok) {
                if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
                    return data.candidates[0].content.parts[0].text;
                }
            }

            if (response.status === 429 || response.status === 503) {
                const waitTime = (i + 1) * 2000;
                console.warn(`Gemini API Busy (${response.status}). Retrying in ${waitTime/1000}s... (${i + 1}/${retries})`);
                await new Promise(res => setTimeout(res, waitTime));
                
                // If it's the last retry and still busy, return the specific fallback
                if (i === retries - 1) {
                    return "I'm receiving too many messages right now and my AI engine is a bit overwhelmed. 😅 Please try again in a moment!";
                }
                continue;
            }

            console.error('Gemini API Error:', JSON.stringify(data));
            break; 
        } catch (error) {
            console.error('Error calling Gemini API:', error);
            await new Promise(res => setTimeout(res, 2000));
        }
    }

    return null;
};

module.exports = { getGeminiResponse };
