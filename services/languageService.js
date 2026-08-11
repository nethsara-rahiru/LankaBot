/**
 * languageService.js
 * Manages user language detection, resolution against org settings, and post-generation translation.
 */

const { getAIResponse } = require('./api-router/apiRouterService');
const { translateText } = require('./lumaTranslator');

/**
 * Known supported language ISO codes → display names.
 */
const SUPPORTED_LANGUAGES_MAP = {
    'en': 'English',
    'si': 'Sinhala',
    'ta': 'Tamil',
    'ja': 'Japanese',
    'fr': 'French',
    'de': 'German',
    'es': 'Spanish',
    'ar': 'Arabic',
    'hi': 'Hindi'
};

/**
 * Reverse map: full language name (lowercase) → ISO code.
 * Includes aliases for Singlish, romanized Tamil, and other common variants
 * so AI-returned values always resolve to a valid ISO code.
 */
const LANGUAGE_NAME_TO_CODE = {
    // Standard full names (auto-generated from map above)
    ...Object.fromEntries(
        Object.entries(SUPPORTED_LANGUAGES_MAP).map(([code, name]) => [name.toLowerCase(), code])
    ),
    // Singlish = Sinhala in English letters (e.g. "mama ganna", "kohomada")
    'singlish': 'si',
    'sinhala (roman)': 'si',
    'romanized sinhala': 'si',
    'sinhala romanized': 'si',
    // Romanized Tamil
    'romanized tamil': 'ta',
    'tamil (roman)': 'ta',
    'tamil romanized': 'ta',
    // Common alternate spellings
    'sinhala': 'si',
    'tamil': 'ta',
    'japanese': 'ja',
    'french': 'fr',
    'german': 'de',
    'spanish': 'es',
    'arabic': 'ar',
    'hindi': 'hi',
    'english': 'en'
};

/**
 * Convert a language value (either ISO code, full name, or alias) to its ISO 639-1 code.
 * Returns null if unrecognised.
 *
 * @param {string} value - e.g. "Sinhala", "Singlish", "si"
 * @returns {string|null} ISO 639-1 code or null
 */
const toISOCode = (value) => {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    // Direct ISO code match
    if (SUPPORTED_LANGUAGES_MAP[trimmed]) return trimmed;
    // Full name or alias match
    if (LANGUAGE_NAME_TO_CODE[trimmed]) return LANGUAGE_NAME_TO_CODE[trimmed];
    // 2-letter fallback
    if (trimmed.length === 2) return trimmed;
    return null;
};

/**
 * System prompt for standalone language detection.
 * Handles Singlish, romanized Tamil, native scripts, and mixed inputs.
 */
const DETECTION_SYSTEM_PROMPT = `You are an expert language and dialect identifier.
Identify the language the user is writing in, even if they use romanized/transliterated text.

IMPORTANT RULES:
- "Singlish" (Sinhala words typed in English letters, e.g. "mama ganna", "kohomada", "oyata", "api", "hari", "nehe", "mokakda", "eka denna", "koheda yanne", "giya") → output: Sinhala
- Sinhala in native script (e.g. "මම", "ඔයා", "කොහොමද") → output: Sinhala
- Romanized Tamil (e.g. "naan vandhen", "enna pannureenga", "vanakkam", "epdi irukinga") → output: Tamil
- Tamil in native script (e.g. "நான்", "என்ன", "வணக்கம்") → output: Tamil
- Arabic script → output: Arabic
- Devanagari (Hindi) → output: Hindi
- Mixed English + Sinhala words → output: Sinhala
- Mixed English + Tamil words → output: Tamil
- Pure or mostly English → output: English
- Any other language → output the full English name of that language

Output ONLY the single full language name. No punctuation, no explanation.`;

/**
 * Helper to update customer preferred language if changed.
 *
 * @param {object} customer  - Mongoose Customer document
 * @param {string} rawLang   - Language code or name detected by Luma or AI
 */
const updateCustomerPreferredLanguage = async (customer, rawLang) => {
    if (!customer || !rawLang) return;
    const isoCode = toISOCode(rawLang);
    if (!isoCode) {
        console.log(`[LanguageService] ⚠️ Could not resolve ISO code for detected language: "${rawLang}"`);
        return;
    }

    const fullName = SUPPORTED_LANGUAGES_MAP[isoCode] || rawLang;
    if (customer.globalProfile?.preferredLanguage !== fullName) {
        customer.globalProfile = customer.globalProfile || {};
        customer.globalProfile.preferredLanguage = fullName;
        try {
            await customer.save();
            console.log(`[LanguageService] 🌐 Updated ${customer.phoneNumber} preferred language: "${rawLang}" → "${fullName}" (${isoCode})`);
        } catch (err) {
            console.error(`[LanguageService] ❌ Error saving preferred language for customer ${customer._id}:`, err.message);
        }
    }
};

/**
 * Detects the language of an incoming user message using Luma Translator auto-detection,
 * with fallback to AI system prompt if Luma is unconfigured or returns empty.
 * Updates customer.globalProfile.preferredLanguage if detected.
 *
 * @param {object} customer   - Mongoose Customer document
 * @param {string} messageText - The user's incoming message
 */
const detectAndSaveLanguage = async (customer, messageText) => {
    if (!customer || !messageText || messageText.trim().length < 2) return;

    try {
        // Step 1 1st translation with Luma to auto-detect language
        const lumaResult = await translateText(messageText, 'en', 'auto');
        const detected = lumaResult?.detectedLanguageName || lumaResult?.detectedSourceLanguage;

        if (detected) {
            await updateCustomerPreferredLanguage(customer, detected);
            return;
        }

        // Fallback: AI system prompt detection
        const detectedName = await getAIResponse(messageText, DETECTION_SYSTEM_PROMPT, 1);
        if (detectedName) {
            await updateCustomerPreferredLanguage(customer, detectedName.trim());
        }
    } catch (err) {
        console.error('[LanguageService] ❌ Error detecting user language:', err.message);
    }
};

/**
 * Resolves the target reply language ISO code for a customer given organisation settings.
 * Handles Singlish → "si", romanized Tamil → "ta", full names, and ISO codes.
 * Does NOT gate on supportedLanguages — any detected language is used directly.
 *
 * @param {object} customer - Customer Mongoose document
 * @param {object} settings - Settings Mongoose document
 * @returns {string} Target ISO language code (e.g. 'en', 'si')
 */
const resolveReplyLanguage = (customer, settings) => {
    const defaultLang = settings?.defaultLanguage || 'en';
    const supportedLangs = settings?.supportedLanguages || ['en'];

    const userPreferred = customer?.globalProfile?.preferredLanguage;
    console.log(`[LanguageService] 🔍 resolveReplyLanguage — preferredLanguage: "${userPreferred}", defaultLang: "${defaultLang}", supported:`, supportedLangs);

    if (!userPreferred || userPreferred === 'auto') {
        console.log(`[LanguageService] → No preference set, using default: "${defaultLang}"`);
        return defaultLang;
    }

    // Normalise to ISO code (handles Singlish → "si", "Sinhala" → "si", "si" → "si", etc.)
    const isoCode = toISOCode(userPreferred);
    console.log(`[LanguageService] → Resolved ISO code: "${isoCode}"`);

    if (!isoCode) {
        console.log(`[LanguageService] → Unknown language "${userPreferred}", using default: "${defaultLang}"`);
        return defaultLang;
    }

    // Enforce organization's supported reply languages
    if (Array.isArray(supportedLangs) && supportedLangs.length > 0 && !supportedLangs.includes(isoCode)) {
        console.log(`[LanguageService] → Language "${isoCode}" is NOT enabled in supportedLanguages (${supportedLangs.join(', ')}), falling back to default: "${defaultLang}"`);
        return defaultLang;
    }

    return isoCode;
};

/**
 * Pipeline to process any outgoing message before sending to WhatsApp (Step 2: After AI Processing).
 * Translates text via Luma Translator if the target language is NOT English ('en').
 *
 * @param {string} text     - Outgoing message text
 * @param {object} customer - Customer Mongoose document
 * @param {object} settings - Settings Mongoose document
 * @returns {Promise<string>} Translated or original message text
 */
const processOutgoingMessage = async (text, customer, settings) => {
    if (!text || typeof text !== 'string') return text;

    const targetLang = resolveReplyLanguage(customer, settings);

    // If target language is English or unidentified, send as-is
    if (!targetLang || targetLang === 'en') {
        console.log(`[LanguageService] → Sending in English, no translation needed.`);
        return text;
    }

    const langName = SUPPORTED_LANGUAGES_MAP[targetLang] || targetLang;
    console.log(`[LanguageService] 🔄 Translating outgoing message to "${langName}" (${targetLang}) via Luma (Step 2)...`);
    const result = await translateText(text, targetLang, 'auto');
    return result?.translation || text;
};

/**
 * Translates an incoming user message to English using Luma Translator (Step 1: Before AI Processing).
 * Auto-detects the source language from Luma's 1st translation response and updates customer's preferredLanguage.
 * Fail-safe: returns the original text unchanged on any error or if Luma is unconfigured.
 *
 * @param {string} text       - The raw user message
 * @param {object} customer   - Customer Mongoose document (used for language auto-detection & persistence)
 * @returns {Promise<{ translatedText: string, wasTranslated: boolean, detectedLanguage: string|null }>}
 */
const translateIncomingToEnglish = async (text, customer) => {
    if (!text || typeof text !== 'string') return { translatedText: text, wasTranslated: false, detectedLanguage: null };

    try {
        console.log(`[LanguageService] 🔄 Luma 1st Translation (Before AI Processing): Translating incoming message & detecting language...`);
        const lumaResult = await translateText(text, 'en', 'auto');

        const detectedLang = lumaResult?.detectedLanguageName || lumaResult?.detectedSourceLanguage;
        if (customer && detectedLang) {
            await updateCustomerPreferredLanguage(customer, detectedLang);
        }

        const translatedText = lumaResult?.translation || text;
        const wasTranslated = lumaResult?.success && translatedText !== text && (lumaResult.detectedSourceLanguage !== 'en');

        if (wasTranslated) {
            console.log(`[LanguageService] ✅ Incoming translation complete: "${text.substring(0, 40)}..." → "${translatedText.substring(0, 40)}..."`);
        }

        return {
            translatedText,
            wasTranslated,
            detectedLanguage: detectedLang || null
        };
    } catch (err) {
        console.error('[LanguageService] ❌ Incoming 1st translation failed, using original:', err.message);
    }

    // Fallback: use original text unchanged
    return { translatedText: text, wasTranslated: false, detectedLanguage: null };
};

module.exports = {
    detectAndSaveLanguage,
    resolveReplyLanguage,
    processOutgoingMessage,
    translateIncomingToEnglish,
    updateCustomerPreferredLanguage,
    SUPPORTED_LANGUAGES_MAP,
    LANGUAGE_NAME_TO_CODE,
    toISOCode
};
