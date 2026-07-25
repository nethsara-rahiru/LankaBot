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
        const { buildExtractionPrompt } = require('../utils/groq');
        const systemPrompt = buildExtractionPrompt(req.body);

        const extractedValue = await getGroqResponse(userInput, systemPrompt, 1);
        
        res.json({ result: extractedValue });
    } catch (error) {
        console.error('Simulator AI extraction error:', error);
        res.status(500).json({ error: 'Failed to extract data via AI' });
    }
});

module.exports = router;
