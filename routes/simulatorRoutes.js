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
        const { userInput, userPrompt, aiPrompt, options, isBoolean } = req.body;
        
        if (!aiPrompt) {
            return res.json({ result: userInput });
        }

        // Construct a specific system prompt for data extraction
        let systemPrompt = `You are a strict data extraction AI.\nYour task is to extract information from the user's response based on the original question and the specific extraction instructions.\n\nORIGINAL QUESTION TO USER:\n"${userPrompt}"\n\nEXTRACTION INSTRUCTION (AI PROMPT):\n"${aiPrompt}"\n\nAVAILABLE OPTIONS:\n${options && options.length > 0 ? options.join(', ') : 'None'}\n\nRULES:\n`;
        
        if (isBoolean) {
            systemPrompt += `1. Evaluate the boolean condition.\n2. Output a JSON object: {"value": true} or {"value": false}\n3. Output ONLY valid JSON.`;
        } else {
            systemPrompt += `1. Extract exactly what is asked in the EXTRACTION INSTRUCTION.\n2. If the user successfully provided the requested information, output a JSON object: {"status": "success", "value": "extracted_value"}\n3. If the user's input is invalid, ambiguous, or missing the required information, output a JSON object: {"status": "fail", "followUp": "A helpful response to ask the user again for the correct information."}\n4. If options are provided, "value" must be the closest matching option.\n5. Output ONLY valid JSON.`;
        }

        const extractedValue = await getGroqResponse(userInput, systemPrompt, 1);
        
        res.json({ result: extractedValue });
    } catch (error) {
        console.error('Simulator AI extraction error:', error);
        res.status(500).json({ error: 'Failed to extract data via AI' });
    }
});

module.exports = router;
