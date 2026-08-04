/**
 * routerConfig.js
 * Defines the AI provider priority chain for the API Router service.
 * Primary: API Router (OpenAI-compatible internal gateway)
 * Fallback: Groq
 */

const routerConfig = {
    primary: {
        name: 'api-router',
        baseUrl: process.env.API_ROUTER_BASE_URL,
        apiKey: process.env.API_ROUTER_API_KEY,
        model: process.env.API_ROUTER_MODEL || 'llama-3.3-70b-versatile'
    },
    fallback: {
        name: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey: process.env.GROQ_API_KEY,
        model: 'llama-3.3-70b-versatile'
    }
};

module.exports = routerConfig;
