const express = require('express');
const router = express.Router();
const { getGroqResponse } = require('../utils/groq');

/**
 * POST /api/simulator/ai-extract
 * Request body: { userInput, userPrompt, aiPrompt, options }
 * 
 * Uses Groq to extract structured data from user input based on the AI Prompt.
 */
router.post('/ai-extract', async (req, res) => {
    try {
        const { userInput, userPrompt, aiPrompt, options } = req.body;
        
        if (!aiPrompt) {
            return res.json({ result: userInput });
        }

        // Construct a specific system prompt for data extraction
        const systemPrompt = `You are a strict data extraction AI.
Your task is to extract information from the user's response based on the original question and the specific extraction instructions.

ORIGINAL QUESTION TO USER:
"${userPrompt}"

EXTRACTION INSTRUCTION (AI PROMPT):
"${aiPrompt}"

AVAILABLE OPTIONS:
${options && options.length > 0 ? options.join(', ') : 'None'}

RULES:
1. Extract exactly what is asked in the EXTRACTION INSTRUCTION.
2. Output ONLY the extracted value. Do not add conversational text.
3. If the value cannot be found or determined, output "null".
4. If options are provided, output the closest matching option.`;

        const extractedValue = await getGroqResponse(userInput, systemPrompt, 1);
        
        res.json({ result: extractedValue });
    } catch (error) {
        console.error('Simulator AI extraction error:', error);
        res.status(500).json({ error: 'Failed to extract data via AI' });
    }
});

module.exports = router;
