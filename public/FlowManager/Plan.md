# FrontDesk AI Conversation Engine Improvement Plan

## 1. Objective

Redesign FrontDesk's conversation handling so that it behaves like a human business assistant rather than a rigid data-extraction system.

The current runtime is heavily focused on extracting the value required by the current flow node.

The new system should allow FrontDesk to:

- Understand the complete user message.
- Extract useful information from any part of the message.
- Answer questions asked by the user.
- Handle multiple intents in one message.
- Handle corrections to previously provided information.
- Understand when the user changes topics.
- Temporarily interrupt a flow and return to it.
- Use the current topic and topic description when making decisions.
- Continue the flow naturally.
- Generate responses based on the actual conversation.
- Use business information and catalog data when available.
- Keep flow execution separate from conversational understanding.

---

# 2. Core Principle

The most important architectural principle is:

> The Flow defines what information the business needs. The AI decides how the user's message should be understood and how the conversation should proceed.

The AI must not treat the current flow node as the only purpose of the user's message.

### Current behaviour

```text
User Message
      ↓
Current Node
      ↓
Extract Required Variable
      ↓
Continue Flow
```

### New behaviour

```text
User Message
      ↓
Understand Message
      ↓
Extract Information
      ↓
Detect Questions
      ↓
Detect Intent
      ↓
Detect Topic Changes
      ↓
Determine Actions
      ↓
Update Runtime
      ↓
Generate Natural Response
      ↓
Continue Flow
```

---

# 3. Example of the Problem

Current flow:

```text
Collect Name
Collect Address
Collect Phone
```

Bot:

```text
What is your delivery address?
```

User:

```text
I'm in Colombo. Also, how much is delivery?
```

Current system may only extract:

```text
address = Colombo
```

and continue.

The new system should understand:

```text
address = Colombo

userQuestion = "How much is delivery?"
```

Then:

```text
1. Save address.
2. Answer delivery question.
3. Continue the order flow.
```

Expected response:

```text
Got it, your delivery address is Colombo.
Delivery to Colombo is Rs. 300.

What is your phone number?
```

---

# 4. New Conversation Architecture

Introduce a dedicated Conversation Engine between the FlowRuntime and AI services.

```text
                       User Message
                            │
                            ▼
                  Conversation Engine
                            │
             ┌──────────────┼──────────────┐
             │              │              │
             ▼              ▼              ▼
        Understanding   Data Extraction   Questions
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                    Runtime Decision
                            │
             ┌──────────────┼──────────────┐
             │              │              │
             ▼              ▼              ▼
        Update Data     Answer User    Topic Change
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                    Continue Flow
                            │
                            ▼
                  Response Generation
                            │
                            ▼
                       API Router
                            │
                            ▼
                    Luma Translator
                            │
                            ▼
                           User
```

---

# 5. Responsibilities

## FlowRuntime

FlowRuntime should be responsible for:

- Executing nodes.
- Maintaining flow state.
- Maintaining variables.
- Moving between nodes.
- Handling waiting states.
- Executing runtime actions.
- Preserving flow state during interruptions.

FlowRuntime should NOT be responsible for understanding natural language itself.

---

## Conversation Engine

Conversation Engine should be responsible for:

- Understanding user messages.
- Detecting intent.
- Extracting data.
- Detecting questions.
- Detecting corrections.
- Detecting multiple intents.
- Detecting topic changes.
- Determining conversational actions.
- Preparing information for response generation.

---

## Response Generator

Response Generator should be responsible for:

- Creating the final natural-language response.
- Using conversation context.
- Using business information.
- Using flow context.
- Answering user questions.
- Explaining decisions.
- Asking the next required question naturally.

---

# 6. AI Context

Every conversation-processing request should provide sufficient context.

The AI should receive:

```text
User Message
+
Current Conversation
+
Current Topic
+
Topic Description
+
Current Flow
+
Current Node
+
Current Node Requirement
+
Current Variables
+
Available Topics
+
Business Information
+
Catalog Information (when available)
```

---

# 7. Conversation Context

Initially use the current conversation only.

Example:

```json
{
    "conversation": [
        {
            "role": "bot",
            "content": "What is your delivery address?"
        },
        {
            "role": "user",
            "content": "I'm in Colombo. How much is delivery?"
        }
    ]
}
```

The context should be limited to relevant recent conversation so that prompts do not grow unnecessarily large.

---

# 8. Topic Context

Every AI decision should receive the current topic.

Example:

```json
{
    "id": "order",
    "name": "Order",
    "description": "Collect customer information and product details required to create an order."
}
```

Topic descriptions should be used to improve:

- Intent understanding.
- Topic switching.
- Decision making.
- Response generation.

---

# 9. Current Node Context

The AI should receive information about the current node.

Example:

```json
{
    "type": "get",
    "variable": "deliveryAddress",
    "description": "The customer's delivery address."
}
```

Important:

The node is **context**, not a restriction.

The AI should understand:

```text
The flow currently needs the address.
```

It must NOT interpret this as:

```text
Only extract the address and ignore everything else.
```

---

# 10. Variable Context

Provide existing variables to the AI.

Example:

```json
{
    "customerName": "Nethsara",
    "items": [
        {
            "itemId": "MILK500",
            "quantity": 2
        }
    ],
    "deliveryAddress": null
}
```

This allows AI to:

- Avoid asking for information already provided.
- Detect corrections.
- Understand relationships between values.
- Update existing information.

---

# 11. Conversation Understanding Response

The AI should no longer return only:

```json
{
    "value": "Colombo"
}
```

Instead, it should return structured conversation understanding.

Example:

```json
{
    "intent": "multi_intent",

    "extractedData": {
        "deliveryAddress": "Colombo"
    },

    "questions": [
        "How much is delivery?"
    ],

    "actions": [
        {
            "type": "answer_question",
            "question": "How much is delivery?"
        }
    ],

    "topicChange": null
}
```

The final schema should be designed during implementation.

---

# 12. Intent Types

The Conversation Engine should support at least:

```text
PROVIDE_DATA
ASK_QUESTION
CHANGE_DATA
ADD_DATA
REMOVE_DATA
ADD_ITEM
REMOVE_ITEM
CONFIRM
REJECT
REQUEST_HELP
CHANGE_LANGUAGE
CHANGE_TOPIC
CANCEL
GENERAL_CONVERSATION
MULTI_INTENT
```

The system must support multiple intents in one message.

---

# 13. Multi-Intent Processing

Example:

```text
I want 3 milk bottles, I'm in Colombo,
my phone number is 0771234567,
and do you deliver tomorrow?
```

AI should identify:

```text
items = 3 milk bottles

address = Colombo

phone = 0771234567

question = Do you deliver tomorrow?
```

Runtime should process all applicable actions.

It must not choose only one piece of information.

---

# 14. Separate Understanding and Response Generation

The AI workflow should be divided into two logical stages.

## Stage 1 — Understanding

```text
User Message
      ↓
Conversation Understanding
      ↓
Structured Result
```

## Stage 2 — Response

```text
Structured Result
+
Conversation Context
+
Business Context
+
Flow Context
      ↓
Response Generation
      ↓
Natural Response
```

This prevents the extraction prompt from being responsible for the entire conversation.

---

# 15. Runtime Decision Layer

After receiving the understanding result, FlowRuntime should determine what happens.

Example:

```text
AI Understanding
      │
      ├── Extracted Data
      │       ↓
      │   Update Variables
      │
      ├── User Question
      │       ↓
      │   Generate Answer
      │
      ├── Correction
      │       ↓
      │   Update Variable
      │
      ├── Topic Change
      │       ↓
      │   Switch Topic
      │
      └── Flow Requirement
              ↓
          Continue Flow
```

Multiple actions may happen from one message.

---

# 16. Conversation Interruptions

Introduce temporary conversation interruptions.

Example:

```text
Current Flow:
Order

Current Node:
Collect Address
```

User:

```text
What time do you close?
```

Runtime:

```text
Current Flow
     ↓
Detect Question
     ↓
Answer Question
     ↓
Return to Current Node
```

The flow state must remain intact.

---

# 17. Topic Switching

AI should decide whether the user:

1. Is continuing the current topic.
2. Is asking a temporary question.
3. Is actually switching topics.

Example:

```text
Current Topic:
Order
```

User:

```text
How much is delivery?
```

Expected:

```text
Temporary question
```

User:

```text
Actually forget the order.
Tell me about your services.
```

Expected:

```text
Topic switch
```

---

# 18. Flow State Preservation

When an interruption occurs, preserve:

```text
Current Topic
Current Flow
Current Node
Current Variables
Pending Question
Previous Topic
Previous Node
```

Example:

```text
Order Flow
   ↓
Collect Address
   ↓
User asks unrelated question
   ↓
Answer question
   ↓
Restore Order Flow
   ↓
Continue Address
```

---

# 19. Corrections

Users should be able to change previously provided information.

Example:

```text
User:
My address is Colombo.
```

Later:

```text
Actually, I'm in Vavuniya.
```

Expected:

```text
address = Vavuniya
```

The AI should identify this as a correction rather than creating a second address.

---

# 20. Natural Flow Progression

The runtime should determine missing information dynamically.

Example:

Required:

```text
name
address
phone
```

User:

```text
I'm Nethsara from Colombo.
```

Runtime should detect:

```text
name = Nethsara
address = Colombo

Missing:
phone
```

Then ask:

```text
What is your phone number?
```

It should NOT ask:

```text
What is your name?
```

again.

---

# 21. Follow-Up Questions

Follow-up questions should be generated naturally based on what is still missing.

Instead of:

```text
Please provide address.
```

the system should generate context-aware responses.

Example:

```text
Thanks, Nethsara. I've got your address as Colombo.
What phone number should we use for the delivery?
```

---

# 22. Response Generation Context

Response generation should receive:

```text
Original User Message
+
Conversation History
+
AI Understanding
+
Current Topic
+
Topic Description
+
Current Flow
+
Current Node
+
Current Variables
+
Business Information
+
Available Actions
+
Catalog Data (if applicable)
```

The response generator should decide how to naturally communicate the result.

---

# 23. API Router

All new AI operations must use the API Router.

Architecture:

```text
Conversation Engine
       ↓
AI Service
       ↓
API Router Service
       ↓
API Router
       ↓
Selected AI Model
```

Groq remains available as a fallback.

FrontDesk core logic should not directly call Groq.

---

# 24. Luma Translator

For Phase 1:

Do not translate incoming user messages.

Use:

```text
User
 ↓
Original Language
 ↓
Conversation Engine
```

Outgoing responses continue through Luma:

```text
Response
 ↓
User Preferred Language
 ↓
Luma Translator
 ↓
User
```

Input translation can be implemented later.

---

# 25. Existing `onAIExtract`

The existing:

```javascript
onAIExtract(...)
```

is extraction-oriented.

It should eventually evolve toward:

```javascript
onAIProcessMessage({
    userInput,
    conversation,
    currentTopic,
    currentNode,
    variables,
    flowTopics,
    businessContext
})
```

Possible response:

```javascript
{
    understanding: {
        intent: "MULTI_INTENT"
    },

    extractedData: {
        deliveryAddress: "Colombo"
    },

    questions: [
        "How much is delivery?"
    ],

    actions: [],

    topicChange: null,

    flow: {
        continue: true
    }
}
```

The existing callback should be retained during migration to prevent breaking existing flows.

---

# 26. Existing Flow Nodes

The following nodes should be updated to work with the new Conversation Engine:

```text
get
getOption
ifAI
say
wait
```

The highest priority is:

```text
get
getOption
```

because these are currently responsible for most follow-up/extraction behaviour.

---

# 27. `get` Node Redesign

Current behaviour:

```text
Ask question
 ↓
Extract one variable
 ↓
Continue
```

New behaviour:

```text
Ask question
 ↓
User responds
 ↓
Understand entire response
 ↓
Extract any relevant data
 ↓
Answer additional questions
 ↓
Handle corrections
 ↓
Handle interruptions
 ↓
Determine missing information
 ↓
Continue flow
```

---

# 28. `getOption` Node Redesign

Users should not have to respond using the exact option text.

Example options:

```text
Delivery
Pickup
Courier
```

User:

```text
Can you bring it to my house?
```

AI should understand:

```text
Delivery
```

But if the user asks:

```text
How much does delivery cost?
```

the system should answer the question rather than incorrectly treating it as an invalid option.

---

# 29. Option Ambiguity

If AI cannot confidently identify an option:

```text
User:
I want the other one.
```

and multiple options are possible, FrontDesk should ask for clarification.

It should not randomly select an option.

---

# 30. AI Decision Confidence

The Conversation Engine should internally distinguish between:

```text
High confidence
Medium confidence
Low confidence
```

High confidence:

```text
Execute action
```

Medium confidence:

```text
Ask clarification if necessary
```

Low confidence:

```text
Do not modify important data
Ask user
```

The exact confidence implementation can be decided during development.

---

# 31. Conversation Safety

The AI must not overwrite important variables based on uncertain interpretation.

Example:

```text
Current:
quantity = 10
```

User:

```text
Maybe make it smaller.
```

The system should not automatically change:

```text
quantity = 5
```

Instead:

```text
Do you want to reduce the quantity?
```

---

# 32. Prompt Architecture

Do not create one massive prompt containing every responsibility.

Use separate prompt responsibilities:

### Understanding Prompt

Responsible for:

```text
Understand user message
Extract information
Identify intent
Identify questions
Identify topic changes
```

### Response Prompt

Responsible for:

```text
Generate natural customer response
```

### Specialized AI Tasks

Existing specialized operations can remain:

```text
ifAI
catalog matching
structured extraction
option matching
```

but should use the Conversation Engine where appropriate.

---

# 33. Context Management

The system should not continuously send unlimited conversation history.

Initially:

```text
Current conversation only
```

Use relevant recent messages.

Later, context management can introduce:

```text
Recent conversation
+
Conversation summary
+
Important variables
```

The goal is to keep AI context useful without unnecessarily increasing token usage.

---

# 34. Business Context

The response generator should eventually have access to business information such as:

```text
Business name
Business description
Services
Opening hours
Contact details
Policies
Catalog
```

This allows FrontDesk to answer user questions while still executing flows.

---

# 35. Catalog Integration

Catalog should be integrated after the Conversation Engine foundation.

Example:

```text
User:
Do you have 500ml milk?
```

Conversation Engine:

```text
User is asking about product availability.
```

Catalog:

```text
Search catalog
```

Response Generator:

```text
Generate natural response.
```

This keeps Catalog as a knowledge source rather than mixing catalog logic into FlowRuntime.

---

# 36. Order Integration

Orders should use the same conversational engine.

Example:

```text
User:
I want 3 bottles of milk.
```

Conversation Engine:

```text
Detect product
Detect quantity
```

Catalog:

```text
Identify product
```

Variables:

```text
items = [...]
```

Flow:

```text
Continue order collection
```

Confirmation:

```text
Ask user to confirm
```

Order Manager:

```text
Create order
```

---

# 37. Recommended Service Structure

Suggested architecture:

```text
/services/

    conversation/
        conversationService.js
        understandingService.js
        responseService.js
        actionService.js
        contextService.js

    ai/
        ...

    api-router/
        apiRouterClient.js
        apiRouterService.js
        routerConfig.js

    translation/
        lumaTranslatorClient.js
        lumaTranslatorService.js

    catalog/
        ...

    orders/
        ...
```

The exact directory names can be adapted to the existing FrontDesk codebase.

---

# 38. Runtime Changes

FlowRuntime should remain responsible for execution.

Add capabilities such as:

```javascript
processUserMessage()
understandUserMessage()
applyConversationActions()
handleInterruption()
handleTopicSwitch()
continueFlow()
generateResponse()
```

Avoid putting all AI logic directly inside `runtime.js`.

---

# 39. Migration Strategy

Do not rewrite the entire runtime at once.

Use incremental migration.

```text
Existing Runtime
       ↓
Conversation Engine
       ↓
Existing callbacks
       ↓
Gradually migrate nodes
```

Recommended order:

```text
1. get
2. getOption
3. topic switching
4. interruptions
5. response generation
6. ifAI
7. remaining conversation paths
```

---

# 40. Phase 1 — Analyse Existing System

Inspect:

```text
runtime.js
whatsapp.js
onAIExtract
get
getOption
ifAI
topic switching
reply handling
prompt generation
```

Document:

- Where user messages enter.
- Where AI is called.
- Where variables are updated.
- Where responses are generated.
- Where flow state changes.
- Where topic switching happens.

Do not modify behaviour during this phase.

---

# 41. Phase 2 — Build Conversation Understanding

Create:

```text
conversationService.js
understandingService.js
```

Implement:

```text
User Message
+
Context
 ↓
API Router
 ↓
Structured Understanding
```

Test this independently before integrating with FlowRuntime.

---

# 42. Phase 3 — Build Action Processor

Create a standard action system.

Example:

```json
{
    "actions": [
        {
            "type": "set_variable",
            "variable": "address",
            "value": "Colombo"
        },
        {
            "type": "answer_question",
            "question": "How much is delivery?"
        }
    ]
}
```

The runtime executes these actions.

---

# 43. Phase 4 — Integrate `get`

Modify `get` nodes to use Conversation Engine.

Test:

```text
Normal extraction
Extraction + question
Multiple values
Correction
Interruption
Unrelated question
```

---

# 44. Phase 5 — Integrate `getOption`

Modify option handling to support:

```text
Natural language
Questions
Corrections
Ambiguous responses
Multiple intents
```

---

# 45. Phase 6 — Implement Interruptions

Implement:

```text
Conversation interruption
        ↓
Handle interruption
        ↓
Restore flow state
        ↓
Continue original flow
```

---

# 46. Phase 7 — Improve Topic Switching

Provide:

```text
Current Topic
Topic Description
Available Topics
Conversation
User Message
```

AI determines:

```text
Continue
Interrupt
Switch
```

---

# 47. Phase 8 — Response Generation

Introduce a dedicated response-generation service.

The response should be generated after the runtime knows:

```text
What the user said
What information was extracted
What questions they asked
What actions occurred
What information is still required
```

---

# 48. Phase 9 — Luma Integration

Apply Luma to all outgoing responses.

Pipeline:

```text
AI Response
 ↓
Determine User Preferred Language
 ↓
Check Supported Languages
 ↓
Luma Translator
 ↓
Send
```

This should apply consistently to:

```text
AI replies
Flow replies
Welcome messages
Product replies
Menu replies
Appointment replies
Handover messages
Error messages
Fallback messages
```

---

# 49. Phase 10 — Catalog Integration

Once the Conversation Engine works:

```text
Conversation Engine
        ↓
Catalog Service
        ↓
Product / Service Information
        ↓
Response Generation
```

Catalog data should be fetched according to the previously defined real-time strategy.

---

# 50. Phase 11 — Order Integration

Use the same conversation engine for order collection.

```text
User Message
      ↓
Conversation Engine
      ↓
Catalog Matching
      ↓
Flow Variables
      ↓
Confirmation
      ↓
Place Order
```

---

# 51. Testing Strategy

Build a permanent conversation test suite.

## Test A — Normal Extraction

```text
Bot:
What is your name?

User:
Nethsara
```

Expected:

```text
name = Nethsara
```

---

## Test B — Extraction + Question

```text
Bot:
What is your address?

User:
I'm in Colombo. How much is delivery?
```

Expected:

```text
address = Colombo

Answer delivery question

Continue flow
```

---

## Test C — Multiple Information

```text
I'm Nethsara from Colombo and my phone is 0771234567.
```

Expected:

```text
name = Nethsara
address = Colombo
phone = 0771234567
```

---

## Test D — Interruption

```text
Bot:
What is your address?

User:
Before that, what time do you close?
```

Expected:

```text
Answer opening-hours question

Return to address collection
```

---

## Test E — Topic Switch

```text
User:
Forget the order. Tell me about your services.
```

Expected:

```text
Switch topic
```

---

## Test F — Correction

```text
User:
My address is Colombo.

Later:

Actually I'm in Vavuniya.
```

Expected:

```text
address = Vavuniya
```

---

## Test G — Multiple Intent

```text
I want three milk bottles, my address is Colombo,
and do you deliver tomorrow?
```

Expected:

```text
items = 3 milk bottles
address = Colombo
answer delivery question
continue flow
```

---

## Test H — Ambiguous Input

```text
User:
Give me the large one.
```

Expected:

```text
Ask clarification if multiple items match.
```

---

# 52. Performance Considerations

Because conversation processing can require multiple AI calls, optimize the architecture.

Avoid:

```text
AI call for extraction
+
AI call for question detection
+
AI call for topic detection
+
AI call for response
```

for every message unless necessary.

Prefer one primary understanding call:

```text
User Message
 ↓
Conversation Understanding
 ↓
Structured Result
```

Then only invoke additional AI operations when required.

Response generation may be a second call when a natural response is needed.

---

# 53. Failure Handling

If the Conversation Engine fails:

```text
AI failure
 ↓
Retry once
 ↓
Fallback to existing extraction system
```

If structured output is invalid:

```text
Invalid JSON
 ↓
Attempt repair / retry
 ↓
Fallback
```

The conversation must never become stuck because of an AI failure.

---

# 54. Observability

Add logging for AI decisions.

For each processed message, record internally:

```text
message
currentTopic
currentNode
AI understanding
extractedData
actions
topicDecision
runtime decision
response generation result
```

Do not expose sensitive conversation data unnecessarily.

This will make debugging dramatically easier.

---

# 55. Success Metrics

The new system should be evaluated against measurable scenarios.

Important metrics:

```text
Correct information extraction
Correct question detection
Correct topic switching
Correct interruption handling
Correct variable updates
Reduction in repeated questions
Reduction in unnecessary follow-ups
Response relevance
Conversation completion rate
```

The most important practical metric is:

> How often does FrontDesk make the user repeat something they already told it?

This should decrease significantly.

---

# 56. Final Architecture

```text
                         USER
                           │
                           ▼
                 ┌───────────────────┐
                 │ Conversation      │
                 │ Engine             │
                 │                    │
                 │ Understand         │
                 │ Extract            │
                 │ Detect Intent      │
                 │ Detect Questions   │
                 │ Detect Corrections │
                 │ Detect Topic       │
                 └─────────┬──────────┘
                           │
                           ▼
                    Runtime Decision
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
      Variables       User Question     Topic Change
          │                │                │
          ▼                ▼                ▼
       Update          Answer User      Switch/Interrupt
          │                │                │
          └────────────────┼────────────────┘
                           │
                           ▼
                    Continue Flow
                           │
                           ▼
                  Response Generation
                           │
                           ▼
                      API Router
                           │
                           ▼
                   Luma Translator
                           │
                           ▼
                         USER
```

---

# 57. Final Design Philosophy

FrontDesk should not behave like:

```text
Question
 ↓
Extract answer
 ↓
Next question
```

It should behave like:

```text
Business Goal
      ↓
Conversation
      ↓
Understand User
      ↓
Remember What They Said
      ↓
Answer What They Ask
      ↓
Use What They Already Provided
      ↓
Handle Interruptions
      ↓
Handle Corrections
      ↓
Decide What Is Still Needed
      ↓
Continue Naturally
      ↓
Complete Business Goal
```

The ultimate goal is:

> **FrontDesk should feel like a human receptionist who understands the customer while quietly managing the business workflow in the background.**

The Flow Manager defines the business process.

The Conversation Engine understands the customer.

The Runtime executes the process.

The AI generates natural responses.

Luma delivers those responses in the customer's preferred supported language.

These responsibilities should remain clearly separated throughout the implementation.