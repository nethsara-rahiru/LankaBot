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

const buildExtractionPrompt = (data) => {
    let systemPrompt = `You are a strict data extraction AI.\nYour task is to extract information from the user's response based on the original question and the specific extraction instructions.\n\nORIGINAL QUESTION TO USER:\n"${data.userPrompt || ''}"\n\nEXTRACTION INSTRUCTION (AI PROMPT):\n"${data.aiPrompt || ''}"\n\nAVAILABLE OPTIONS:\n${data.options && data.options.length > 0 ? data.options.join(', ') : 'None'}\n\nAVAILABLE FLOW TOPICS:\n${data.flowTopics || 'None'}\n\nRULES:\n`;
    
    if (data.isBoolean) {
        systemPrompt += `1. Evaluate the boolean condition.\n2. Output a JSON object: {"value": true} or {"value": false}\n3. Output ONLY valid JSON.`;
    } else if (data.noAiPrompt) {
        systemPrompt += `CRITICAL INSTRUCTION: FIRST, evaluate if the user's input is explicitly ignoring the current question and asking about one of the AVAILABLE FLOW TOPICS. If they are asking about a topic, you MUST output a JSON object: {"status": "redirect", "topicId": "matching_topic_id"} and STOP.\n\nIf they are NOT asking about a different topic, simply output a JSON object with the user's raw input as the value: {"status": "success", "value": "the exact user input"}\n\nOutput ONLY valid JSON.`;
    } else {
        systemPrompt += `CRITICAL INSTRUCTION: FIRST, evaluate if the user's input is explicitly ignoring the current question and instead asking about one of the AVAILABLE FLOW TOPICS. If they are asking about a topic, you MUST immediately output a JSON object: {"status": "redirect", "topicId": "matching_topic_id"} and STOP.\n\nONLY if they are NOT asking about a different topic, proceed with the following rules:\n1. Extract exactly what is asked in the EXTRACTION INSTRUCTION.\n2. If the user successfully provided the requested information, output a JSON object: {"status": "success", "value": "extracted_value"}\n3. If the user's input is invalid, ambiguous, or missing the required information, output a JSON object: {"status": "fail", "followUp": "A helpful response to ask the user again for the correct information."}\n4. If options are provided, "value" must be the closest matching option.\n5. Output ONLY valid JSON.`;
    }
    return systemPrompt;
};

module.exports = { getGroqResponse, getPromptTemplate, getPromptScripts, buildExtractionPrompt };
