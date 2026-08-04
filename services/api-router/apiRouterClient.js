/**
 * apiRouterClient.js
 * Low-level HTTP client for any OpenAI-compatible chat completions endpoint.
 * Handles authentication, retries, and response parsing.
 */

/**
 * Sends a chat completion request to the given provider.
 *
 * @param {object} provider  - Provider config { name, baseUrl, apiKey, model }
 * @param {Array}  messages  - OpenAI messages array [{ role, content }, ...]
 * @param {number} retries   - Max retry attempts (default 3)
 * @returns {Promise<string|null>} AI response text or null on failure
 */
const sendRequest = async (provider, messages, retries = 3) => {
    if (!provider.apiKey) {
        console.error(`[APIRouterClient] ❌ API key not set for provider: ${provider.name}`);
        return null;
    }

    if (!provider.baseUrl) {
        console.error(`[APIRouterClient] ❌ Base URL not set for provider: ${provider.name}`);
        return null;
    }

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(provider.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${provider.apiKey}`
                },
                body: JSON.stringify({
                    model: provider.model,
                    messages,
                    temperature: 0.7,
                    max_tokens: 1024
                })
            });

            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.error(`[APIRouterClient] ❌ Provider "${provider.name}" returned non-JSON response (${response.status}): ${text.substring(0, 150)}`);
                break;
            }

            if (response.ok) {
                const content = data?.choices?.[0]?.message?.content;
                if (content) return content;
            }

            // Rate limit or temporary overload — back off and retry
            if (response.status === 429 || response.status === 503) {
                const waitTime = (i + 1) * 2000;
                console.warn(`[APIRouterClient] ⚠️ Provider "${provider.name}" busy (${response.status}). Retrying in ${waitTime / 1000}s... (${i + 1}/${retries})`);
                await new Promise(res => setTimeout(res, waitTime));
                continue;
            }

            console.error(`[APIRouterClient] ❌ Provider "${provider.name}" error (${response.status}):`, JSON.stringify(data));
            break;

        } catch (error) {
            console.error(`[APIRouterClient] ❌ Network error for provider "${provider.name}":`, error.message);
            await new Promise(res => setTimeout(res, 2000));
        }
    }

    return null;
};

module.exports = { sendRequest };
