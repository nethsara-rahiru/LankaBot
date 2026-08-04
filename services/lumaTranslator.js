/**
 * lumaTranslator.js
 * HTTP client for the Luma Translator service.
 * Provides natural-quality translations for FrontDesk outgoing messages.
 */

/**
 * Translates text to the target language using Luma Translator.
 * On any failure, returns the original text unchanged (fail-safe).
 *
 * @param {string} text           - The text to translate
 * @param {string} targetLanguage - BCP-47 language code (e.g. 'si', 'ta', 'fr')
 * @param {string} sourceLanguage - Source language code, defaults to 'auto'
 * @returns {Promise<string>}     - Translated text, or original on failure
 */
const translateText = async (text, targetLanguage, sourceLanguage = 'auto') => {
    const baseUrl = process.env.LUMA_TRANSLATOR_BASE_URL;
    const apiKey = process.env.LUMA_TRANSLATOR_API_KEY;

    if (!baseUrl || !apiKey) {
        console.error('[LumaTranslator] ❌ LUMA_TRANSLATOR_BASE_URL or LUMA_TRANSLATOR_API_KEY is not set.');
        return text;
    }

    if (!text || !targetLanguage) {
        return text;
    }

    try {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                text,
                target_language: targetLanguage,
                mode: 'natural',
                source_language: sourceLanguage
            })
        });

        const data = await response.json();

        if (response.ok && data.success && data.translation) {
            console.log(`[LumaTranslator] ✅ Translated to "${targetLanguage}" (${data.characters} chars).`);
            return data.translation;
        }

        console.error('[LumaTranslator] ❌ Translation failed:', JSON.stringify(data));
        return text;

    } catch (error) {
        console.error('[LumaTranslator] ❌ Network error during translation:', error.message);
        return text;
    }
};

module.exports = { translateText };
