Ran command: `node index.js`
Viewed runtime.js:1-459
Searched for "onAIExtract"
Viewed simulator.js:1-618
Viewed whatsapp.js:86-885

Here is a comprehensive report explaining how data and AI operations are processed within [runtime.js](file:///Volumes/Backup/LankaBot/LankaBot/public/FlowManager/Runtime/runtime.js).

---

# Technical Analysis Report: AI Data Processing in `FlowRuntime`

The `FlowRuntime` class in [runtime.js](file:///Volumes/Backup/LankaBot/LankaBot/public/FlowManager/Runtime/runtime.js) serves as a **state-machine execution engine** that controls user interactions and delegates complex AI operations (data extraction, intent understanding, topic switching, and boolean evaluations) to external AI handlers.

---

## 1. Flow State & Execution Architecture

`FlowRuntime` manages conversation flows through step-by-step state transitions:
* **States (`this.status`)**: `idle`, `running`, `waiting_input`, `waiting_option`, `waiting_ai`, `waiting_timer`, `finished`.
* **State Machine Execution Loop (`step(userInput)`)**: Advances node by node until it hits a node that requires user interaction or AI extraction.

```
       [Start Node]
            │
            ▼
    ┌───────────────┐
    │ Step execution│
    └───────┬───────┘
            │
  ┌─────────┴────────────────────────┐
  │ Node Type                        │
  ├──────────────┬───────────────────┤
  ▼              ▼                   ▼
[say/wait]     [get/getOption]     [ifAI]
  │              │                   │
  │              ├─► waiting_input   ├─► waiting_ai
  │              │   (asks user)     │   (delegates prompt)
  │              │                   │
  └──────────────┼───────────────────┘
                 ▼
         User Input Provided
                 │
                 ▼
     Has `onAIExtract` Hook?
     ├── No  ──► Store raw input / match option directly
     └── Yes ──► Transition to `waiting_ai` & trigger AI Callback
                 │
                 ▼
          AI Returns Result
                 │
         ┌───────┴───────┐
         │ Parse Response│
         └───────┬───────┘
                 ├── Status: `redirect` ──► Switch Topic / Jump to Node
                 ├── Status: `fail`     ──► Send Follow-up & Wait Input
                 └── Success            ──► Save Variable & Advance Node
```

---

## 2. AI Processing Workflow in `runtime.js`

AI involvement in `runtime.js` takes place across 3 primary node types via the **`this.onAIExtract` callback**.

### A. Information Extraction (`get` Node)
1. **Prompt Construction**:
   * Collects previous node conversation context (`this.nodeHistory`) formatted as `USER: ... / BOT: ...`.
   * Interpolates variable placeholders in custom AI prompts (`{{variableName}}`).
   * Extracts available flow topic definitions (`Topic ID: <id>, Description: <desc>`).
2. **AI Delegation**:
   Calls `onAIExtract` with context payload:
   ```javascript
   {
     userInput: fullContext,
     userPrompt: interpolatedUserPrompt,
     aiPrompt: interpolatedAiPrompt,
     options: [],
     expectJson: true,
     flowTopics,
     noAiPrompt: !aiPrompt
   }
   ```
3. **Response Handling & Data Parsing**:
   * Parses JSON return from AI (cleaning markdown tags like ````json`).
   * **Topic Redirect**: If AI returns `{ status: 'redirect', topicId: '...' }`, runtime clears node history and jumps directly to that flow entrypoint.
   * **Extraction Failure**: If AI returns `{ status: 'fail', followUp: '...' }`, runtime sends `parsed.followUp` to the user and stays in `waiting_input`.
   * **Success**: Extracts target value into `this.variables[varName]` and advances to the next step.

### B. Intelligent Option Selection (`getOption` Node)
1. **Option Context Generation**:
   Passes candidate option values (`options: ['Option 1', 'Option 2']`) along with conversation context to `onAIExtract`.
2. **Fuzzy & Natural Language Matching**:
   * Receives AI-parsed response or raw text.
   * Runs fuzzy matching (`_matchOption`) against option list (case-insensitive & substring inclusion check).
   * Stores the matched option value in `this.variables[varName]` and branches to the corresponding option branch (`matched.next`).

### C. AI Boolean Condition Evaluation (`ifAI` Node)
1. Sets runtime status to `waiting_ai`.
2. Invokes `onAIExtract({ userInput: 'Evaluate boolean', aiPrompt: prompt, isBoolean: true, ... })`.
3. Parses output as boolean (`parsed.value === true`).
4. Branches execution path: `nextTrue` vs `nextFalse`.

---

## 3. Integrations with System Components

| Component | Interaction Point | Data Flow |
| :--- | :--- | :--- |
| **Flow Simulator UI** ([simulator.js](file:///Volumes/Backup/LankaBot/LankaBot/public/FlowManager/Simulator/simulator.js#L318)) | `onAIExtract` | Sends POST request to `/api/simulator/ai-extract`, then calls `runtime.step(result.result)`. |
| **WhatsApp Production Bot** ([whatsapp.js](file:///Volumes/Backup/LankaBot/LankaBot/bot/whatsapp.js#L547)) | `onAIExtract` | Builds system prompts, calls LLM via `getAIResponse`, parses language preferences, saves `preferredLanguage` to Customer record, and resumes flow execution. |
| **Global AI Router** ([whatsapp.js](file:///Volumes/Backup/LankaBot/LankaBot/bot/whatsapp.js#L378)) | Global Routing | Evaluates incoming WhatsApp messages against flow topic descriptions to auto-switch flows before `runtime.step()` processes user text. |

---

## 4. Key AI Data Extraction Helper Summary

* **Variable Interpolation (`_interpolate`)**: Replaces `{{variableName}}` with actual live values stored in `this.variables`.
* **Fallback Safety**: If AI extraction returns invalid JSON or encounters an exception, a fallback mechanism safely constructs a `fail` response with a follow-up question so conversation does not break.
* **Variable Broadcasting (`_emitVariables`)**: Fires `onVariableUpdate(variables)` callback whenever AI updates variable state, ensuring live UI panels sync immediately.