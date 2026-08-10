/**
 * lumaTranslator.js
 * HTTP client for the Luma Translator service.
 * Provides natural-quality translations for FrontDesk outgoing messages.
 */

/**
 * Translates text to the target language using Luma Translator.
 * Returns structured object with translation result and detected source language details.
 * On any failure, returns original text unchanged (fail-safe).
 *
 * @param {string} text           - The text to translate
 * @param {string} targetLanguage - BCP-47 language code (e.g. 'si', 'ta', 'fr', 'en')
 * @param {string} sourceLanguage - Source language code, defaults to 'auto'
 * @returns {Promise<{ translation: string, detectedSourceLanguage: string|null, detectedLanguageName: string|null, success: boolean }>}
 */
const translateText = async (text, targetLanguage, sourceLanguage = 'auto') => {
    const baseUrl = process.env.LUMA_TRANSLATOR_BASE_URL;
    const apiKey = process.env.LUMA_TRANSLATOR_API_KEY;

    if (!baseUrl || !apiKey) {
        console.error('[LumaTranslator] ❌ LUMA_TRANSLATOR_BASE_URL or LUMA_TRANSLATOR_API_KEY is not set.');
        return { translation: text, detectedSourceLanguage: null, detectedLanguageName: null, success: false };
    }

    if (!text || !targetLanguage) {
        return { translation: text, detectedSourceLanguage: null, detectedLanguageName: null, success: false };
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
            console.log(`[LumaTranslator] ✅ Translated to "${targetLanguage}" (${data.characters || 0} chars). Source detected: ${data.detected_source_language || 'unknown'} (${data.detected_language_name || 'unknown'})`);
            return {
                translation: data.translation,
                detectedSourceLanguage: data.detected_source_language || null,
                detectedLanguageName: data.detected_language_name || null,
                success: true
            };
        }

        console.error('[LumaTranslator] ❌ Translation failed:', JSON.stringify(data));
        return { translation: text, detectedSourceLanguage: null, detectedLanguageName: null, success: false };

    } catch (error) {
        console.error('[LumaTranslator] ❌ Network error during translation:', error.message);
        return { translation: text, detectedSourceLanguage: null, detectedLanguageName: null, success: false };
    }
};

module.exports = { translateText };
