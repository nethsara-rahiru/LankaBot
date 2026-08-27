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
    const langDetectionRule = `LANGUAGE DETECTION RULE:
You MUST detect which language or dialect the user is communicating in, even if they use non-standard scripts or romanized transliterations. Be smart about this:
- "Singlish" = Sinhala written in English letters (e.g. "mama ganna", "kohomada", "oyage name eka", "eka denna", "api yanawa", "hari", "nehe") → report as "Sinhala"
- "Romanized Tamil" = Tamil written in English letters (e.g. "naan vandhen", "enna pannureenga", "vanakkam") → report as "Tamil"
- Native Sinhala script (e.g. "මම", "ඔයා") → report as "Sinhala"
- Native Tamil script (e.g. "நான்", "என்ன") → report as "Tamil"
- Arabic script → report as "Arabic"
- Devanagari (Hindi) → report as "Hindi"
- Mixed English + Sinhala words → report as "Sinhala"
- Mixed English + Tamil words → report as "Tamil"
- Pure English → report as "English"
Always use the full English language name. This field is MANDATORY.
`;

    let systemPrompt = `You are a strict data extraction AI.
Your task is to extract information from the user's response based on the original question, current topic context, and specific extraction instructions.

TRANSLATION & PROCESSING STEP (CRITICAL):
1. Mentally or explicitly translate the user's input into clear English first (handling Singlish, native Sinhala, romanized Tamil, native Tamil, or any other language/transliteration).
2. If the user input contains a quoted/replied message (formatted as [Replying to message: "..."]), inspect the quoted message content to identify the referenced product, option, item number, or prompt context, and combine it with the user's reply to determine the extracted value or option match.
3. Process all decision-making (topic redirect evaluation, value extraction, option matching, boolean evaluation) using the TRANSLATED ENGLISH MEANING of the user's input and quoted reply context.

CURRENT ACTIVE TOPIC:
- Topic ID: ${data.currentTopicId || 'default'}
- Description: ${data.currentTopicDescription || 'General flow execution'}

ORIGINAL QUESTION TO USER:
"${data.userPrompt || ''}"

EXTRACTION INSTRUCTION (AI PROMPT):
"${data.aiPrompt || ''}"

AVAILABLE OPTIONS:
${data.options && data.options.length > 0 ? data.options.join(', ') : 'None'}

AVAILABLE FLOW TOPICS:
${data.flowTopics || 'None'}

${langDetectionRule}
RULES:
`;
    
    if (data.isBoolean) {
        systemPrompt += `1. Translate the user input to English, then evaluate the boolean condition against the English meaning.
2. Output a JSON object: {"value": true, "preferredLanguage": "English"}
3. Replace "English" with the actual detected language of the user's message (use "Sinhala" for Singlish inputs).
4. Output ONLY valid JSON.`;
    } else if (data.noAiPrompt) {
        systemPrompt += `CRITICAL INSTRUCTION:
STEP 1: Translate the user's input to English.
STEP 2: Using the translated English meaning, evaluate if the user's input is explicitly ignoring the current question and asking about one of the AVAILABLE FLOW TOPICS. If they are asking about a topic, you MUST output a JSON object: {"status": "redirect", "topicId": "matching_topic_id", "preferredLanguage": "detected_language_name"} and STOP.

If they are NOT asking about a different topic, simply output a JSON object with the user's raw input (or translated value if applicable) as the value: {"status": "success", "value": "the exact user input", "preferredLanguage": "detected_language_name"}

Replace "detected_language_name" with the actual detected language (e.g. "Sinhala" for both Sinhala script and Singlish, "Tamil" for both Tamil script and romanized Tamil, "English" for English).
Output ONLY valid JSON.`;
    } else {
        systemPrompt += `CRITICAL INSTRUCTION:
STEP 1: Translate the user's input to English.
STEP 2: Using the translated English meaning, evaluate if the user's input is explicitly ignoring the current question and instead asking about one of the AVAILABLE FLOW TOPICS. If they are asking about a topic, you MUST immediately output a JSON object: {"status": "redirect", "topicId": "matching_topic_id", "preferredLanguage": "detected_language_name"} and STOP.

ONLY if they are NOT asking about a different topic, proceed with the following rules using the English translation:
1. Extract exactly what is asked in the EXTRACTION INSTRUCTION based on the translated English meaning.
2. If the user successfully provided the requested information, output a JSON object: {"status": "success", "value": "extracted_value", "preferredLanguage": "detected_language_name"}
3. If the user's input is invalid, ambiguous, or missing the required information, output a JSON object: {"status": "fail", "followUp": "Contextual friendly response", "preferredLanguage": "detected_language_name"}.
   IMPORTANT FOR "followUp": Never use generic robotic phrases like "I didn't quite catch that" or "Could you please clarify?". Instead, briefly acknowledge or answer what the user said in a friendly manner, then naturally ask them again for the specific information needed to complete their goal.
   CRITICAL JSON OUTPUT RULE: Output ONLY raw JSON. Do NOT wrap in markdown codeblocks. Do NOT include any conversational preamble, intro text, or explanation before or after the JSON.
4. If options are provided, compare the translated English meaning against the options to find the closest matching option for "value".
5. Replace "detected_language_name" with the detected language (e.g. "Sinhala" for Singlish, "Tamil" for romanized Tamil, "English" for English, "French" for French, etc.).
6. Output ONLY valid JSON.`;
    }
    return systemPrompt;
};


module.exports = { getGroqResponse, getPromptTemplate, getPromptScripts, buildExtractionPrompt };
