/**
 * Utility to interact with Groq AI API (OpenAI Compatible)
 */

const getGroqResponse = async (prompt, systemPrompt, retries = 3) => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.error('GROQ_API_KEY is not set in .env');
        return null;
    }

    const url = "https://api.groq.com/openai/v1/chat/completions";

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt || "You are LankaBot, a professional AI assistant."
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 1024
                })
            });

            const data = await response.json();
            
            if (response.ok) {
                if (data.choices && data.choices[0].message && data.choices[0].message.content) {
                    return data.choices[0].message.content;
                }
            }

            if (response.status === 429 || response.status === 503) {
                const waitTime = (i + 1) * 2000;
                console.warn(`Groq API Busy (${response.status}). Retrying in ${waitTime/1000}s... (${i + 1}/${retries})`);
                await new Promise(res => setTimeout(res, waitTime));
                continue;
            }

            console.error('Groq API Error:', JSON.stringify(data));
            break; 

        } catch (error) {
            console.error('Error calling Groq API:', error);
            await new Promise(res => setTimeout(res, 2000));
        }
    }

    return "I'm experiencing some connectivity issues with my AI brain (Groq). Please try again in a moment! 🧠⚡";
};

module.exports = { getGroqResponse };
