/**
 * Utility to interact with FrontDesk AI API (OpenAI Compatible)
 */

const fs = require('fs');
const path = require('path');

const AI_DIR = path.join(__dirname, '..', 'AI', 'scripts');

const FILE_ORDER = [
    'system_prompt.txt',
    'role_and_behavior.txt',
    'customer_memory_system.txt',
    'global_customer_information.txt',
    'organization_speciffic_customer_memory.txt',
    'current_conversation Memory.txt',
    'language_policy.txt',
    'company_knowledge.txt',
    'respons_style.txt',
    'ai_decision_process.txt',
    'current_customer_data.txt',
    'rule.txt'
];

let cachedPromptTemplate = null;

const getPromptTemplate = () => {
    if (cachedPromptTemplate) return cachedPromptTemplate;

    let template = '';
    if (fs.existsSync(AI_DIR)) {
        const files = fs.readdirSync(AI_DIR);
        for (const file of FILE_ORDER) {
            // Find file case-insensitively, handling spaces/underscores
            const actualFile = files.find(f => f.toLowerCase().replace(/ /g, '_') === file.toLowerCase().replace(/ /g, '_'));
            if (actualFile) {
                template += fs.readFileSync(path.join(AI_DIR, actualFile), 'utf8') + '\n\n';
            } else {
                console.warn(`[Groq] AI script file not found: ${file}`);
            }
        }
    }

    cachedPromptTemplate = template;
    return template;
};

const getGroqResponse = async (prompt, systemPrompt, retries = 3) => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.error('GROQ_API_KEY is not set in .env');
        return null;
    }

    let finalSystemPrompt = "You are FrontDesk, a professional AI assistant.";

    if (systemPrompt && typeof systemPrompt === 'object') {
        let template = getPromptTemplate();
        for (const [key, value] of Object.entries(systemPrompt)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            template = template.replace(regex, value || 'None');
        }
        // Clean up unreplaced placeholders
        template = template.replace(/{{.*?}}/g, 'None');
        finalSystemPrompt = template;
    } else if (typeof systemPrompt === 'string') {
        finalSystemPrompt = systemPrompt;
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
                            content: finalSystemPrompt
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
                console.warn(`FrontDesk API Busy (${response.status}). Retrying in ${waitTime / 1000}s... (${i + 1}/${retries})`);
                await new Promise(res => setTimeout(res, waitTime));
                continue;
            }

            console.error('FrontDesk API Error:', JSON.stringify(data));
            break;

        } catch (error) {
            console.error('Error calling API:', error);
            await new Promise(res => setTimeout(res, 2000));
        }
    }

    return "I'm experiencing some connectivity issues with my AI brain. Please try again in a moment! 🧠⚡";
};

/**
 * Returns individual AI script files as separate objects for UI display.
 */
const getPromptScripts = () => {
    const scripts = [];
    if (!fs.existsSync(AI_DIR)) return scripts;

    const files = fs.readdirSync(AI_DIR);
    for (const file of FILE_ORDER) {
        const actualFile = files.find(f => f.toLowerCase().replace(/ /g, '_') === file.toLowerCase().replace(/ /g, '_'));
        if (actualFile) {
            const content = fs.readFileSync(path.join(AI_DIR, actualFile), 'utf8');
            // Create a readable title from the filename
            const title = actualFile
                .replace(/\.txt$/, '')
                .replace(/[_\-]/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
            scripts.push({ filename: actualFile, title, content });
        }
    }
    return scripts;
};

module.exports = { getGroqResponse, getPromptTemplate, getPromptScripts };
