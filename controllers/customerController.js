const Customer = require('../models/Customer');
const OrganizationContact = require('../models/OrganizationContact');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { getGroqResponse } = require('../utils/groq');

// @desc    Get recent customers for an organization (account)
// @route   GET /api/customers
// @access  Private
exports.getCustomers = async (req, res) => {
    try {
        const accountId = req.header('x-account-id');
        if (!accountId) {
            return res.status(400).json({ msg: 'Account ID header missing' });
        }

        const orgContacts = await OrganizationContact.find({ account: accountId })
            .populate('customer')
            .sort({ lastMessageAt: -1 })
            .limit(50);
            
        res.json(orgContacts);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const analyzeCustomerInternal = async (orgContactId) => {
    const orgContact = await OrganizationContact.findById(orgContactId).populate('customer');
    if (!orgContact) return null;

    const messages = await Message.find({ organizationContact: orgContact._id })
        .sort({ timestamp: -1 })
        .limit(50);
        
    if (messages.length === 0) return null;

    // Reverse to get chronological order for transcript
    const transcript = messages.reverse().map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n');
    
    const systemPrompt = `You are an expert user profiling AI. Analyze the following conversation between a USER and a BOT.
Provide your response strictly in the following JSON format:
{
  "organizationProfile": {
    "summary": "A 2-3 sentence summary of what the user wants and the chat context specific to this business.",
    "customerType": "Retail, Wholesale, or Unknown",
    "facts": [
      {
        "text": "A specific fact learned about the user in relation to this business.",
        "category": "preference"
      }
    ],
    "tags": ["tag1", "tag2"]
  },
  "globalProfile": {
    "preferredLanguage": "User's preferred language (e.g. English, Sinhala)",
    "location": "User's location if mentioned",
    "communicationStyle": "Concise description of communication style"
  }
}
If a specific detail is not found, omit the key or leave empty. Do not include any other text, only the raw JSON.`;

    const aiResponseStr = await getGroqResponse(`Analyze this conversation:\n\n${transcript}`, systemPrompt);
    if (!aiResponseStr) return null;

    try {
        let jsonStr = aiResponseStr.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        
        const analysis = JSON.parse(jsonStr.trim());
        
        if (analysis.organizationProfile) {
            orgContact.organizationProfile.summary = analysis.organizationProfile.summary || '';
            if (analysis.organizationProfile.customerType) orgContact.organizationProfile.customerType = analysis.organizationProfile.customerType;
            if (analysis.organizationProfile.tags) orgContact.organizationProfile.tags = analysis.organizationProfile.tags;
            
            if (analysis.organizationProfile.facts && Array.isArray(analysis.organizationProfile.facts)) {
                // For simplicity we just replace the facts here, but you might want to merge them
                orgContact.organizationProfile.facts = analysis.organizationProfile.facts;
            }
        }
        
        orgContact.lastAnalyzedAt = new Date();
        await orgContact.save();
        
        // Update global customer profile
        if (analysis.globalProfile) {
            const customer = await Customer.findById(orgContact.customer._id);
            if (customer) {
                if (analysis.globalProfile.preferredLanguage) customer.globalProfile.preferredLanguage = analysis.globalProfile.preferredLanguage;
                if (analysis.globalProfile.location) customer.globalProfile.location = analysis.globalProfile.location;
                if (analysis.globalProfile.communicationStyle) customer.globalProfile.communicationStyle = analysis.globalProfile.communicationStyle;
                await customer.save();
            }
        }
        
        return orgContact;
    } catch (parseError) {
        console.error('Failed to parse AI response as JSON:', aiResponseStr);
        return null;
    }
};

// Global queue to prevent Groq API rate limits (HTTP 429)
const analysisQueue = [];
let isProcessingQueue = false;

const processAnalysisQueue = async () => {
    if (isProcessingQueue || analysisQueue.length === 0) return;
    isProcessingQueue = true;

    while (analysisQueue.length > 0) {
        const orgContactId = analysisQueue.shift();
        try {
            await analyzeCustomerInternal(orgContactId);
        } catch (e) {
            console.error('Queue analysis error:', e);
        }
        // Wait 3.5 seconds between analysis requests to respect Groq rate limits (~17 RPM)
        await new Promise(r => setTimeout(r, 3500));
    }
    
    isProcessingQueue = false;
};

exports.queueCustomerAnalysis = (orgContactId) => {
    const idStr = orgContactId.toString();
    if (!analysisQueue.includes(idStr)) {
        analysisQueue.push(idStr);
    }
    processAnalysisQueue();
};

exports.analyzeCustomerInternal = analyzeCustomerInternal;

// @desc    Analyze a customer using AI
// @route   POST /api/customers/:id/analyze
// @access  Private
exports.analyzeCustomer = async (req, res) => {
    try {
        const orgContactId = req.params.id;
        const result = await analyzeCustomerInternal(orgContactId);
        if (result) {
            res.json(result);
        } else {
            res.status(500).json({ msg: 'Failed to analyze customer' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Clear AI knowledge of a customer for this organization
// @route   POST /api/customers/:id/clear
// @access  Private
exports.clearCustomerKnowledge = async (req, res) => {
    try {
        const orgContactId = req.params.id;
        const orgContact = await OrganizationContact.findById(orgContactId);
        
        if (!orgContact) {
            return res.status(404).json({ msg: 'Organization contact not found' });
        }
        
        orgContact.organizationProfile = {
            summary: '',
            facts: [],
            tags: [],
            customerType: ''
        };
        orgContact.lastAnalyzedAt = null;
        
        await orgContact.save();
        res.json(orgContact);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get messages for a specific organization contact
// @route   GET /api/contacts/:id/messages
// @access  Private
exports.getMessages = async (req, res) => {
    try {
        const orgContactId = req.params.id;
        const messages = await Message.find({ organizationContact: orgContactId })
            .sort({ timestamp: 1 })
            .limit(200);
        res.json(messages);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Reset/restart a customer's flow conversation
// @route   POST /api/contacts/:id/reset-flow
// @access  Private
exports.resetFlow = async (req, res) => {
    try {
        const orgContactId = req.params.id;
        const orgContact = await OrganizationContact.findById(orgContactId);
        
        if (!orgContact) {
            return res.status(404).json({ msg: 'Organization contact not found' });
        }

        // Clear flow state in DB
        orgContact.flowState = {
            currentNodeId: null,
            variables: {},
            status: 'idle',
            executedSteps: []
        };
        await orgContact.save();

        // Clear in-memory active flow via bot module
        try {
            const whatsappBot = require('../bot/whatsapp');
            whatsappBot.clearActiveFlow(orgContactId);
        } catch (e) {
            // Bot module may not export this yet, non-critical
            console.warn('Could not clear in-memory active flow:', e.message);
        }

        res.json({ msg: 'Flow conversation restarted', orgContact });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
