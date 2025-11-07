🤖 Gritto Agent Service — Updated Design (LLM-Powered Workflow)

Scope

This document updates the architecture and implementation of the Gritto Python Agent Service, enhancing both `CheckApprovalAgent` and `FinalizeAgent` with LLM-based reasoning while maintaining strict JSON output for plan structures.

────────────────────────────────────────────

🔌 1️⃣ System Architecture

Client (Mobile App)
│
▼
Backend (TypeScript / Express)
│
│  POST /agent/run
▼
Gritto Agent Service (Python / ADK)

├── GoalPlanningWorkflow (SequentialAgent)
│    ├── CheckApprovalAgent (LLM-powered)
│    ├── PlanAgent (LLM-powered)
│    └── FinalizeAgent (LLM-powered)
│
└── Returns structured JSON:
{
"reply": "...",
"action": { "type": "...", "payload": {...} },
"state": {...}
}

Purpose:
The agent interprets user messages, reasons about approval/refinement, and produces structured goal plans compliant with the `GoalPreview` model. All reasoning outputs are strict JSON, validated before returning.

────────────────────────────────────────────

🌐 2️⃣ Exposed Endpoint

**POST /agent/run**

Purpose: Execute one reasoning step in the goal planning workflow.
Consumes: JSON input from backend containing `message`, `context`, and `state`.
Produces: Strict JSON output with `reply`, `action`, and `state`.
Invocation: Only by backend Cloud Run service.

────────────────────────────────────────────

⚙️ 3️⃣ Main Functionality

1. Interpret user message using LLM reasoning.
2. Generate or refine structured goal plan JSON.
3. Produce a final user-facing reply and backend action.
4. Maintain consistent session state.

────────────────────────────────────────────

📥 4️⃣ Input Format

```json
{
  "userId": "u_001",
  "sessionId": "sess_goal_001",
  "message": "Looks good!",
  "context": { ... },
  "state": {
    "step": "plan_generated",
    "iteration": 1,
    "sessionActive": true,
    "proposed_plan": { ... }
  }
}
```

────────────────────────────────────────────

📤 5️⃣ Output Schema

```json
{
  "reply": "string",
  "action": {
    "type": "save_preview" | "finalize_goal" | "none",
    "payload": { ... }
  },
  "state": {
    "step": "plan_generated" | "plan_iteration" | "finalized",
    "iteration": "number",
    "sessionActive": "boolean"
  }
}
```

All fields must be valid JSON, verified via schema validation before return.

────────────────────────────────────────────

🧠 6️⃣ Internal Workflow

**Workflow: GoalPlanningWorkflow (SequentialAgent)**

CheckApprovalAgent (LLM) ↓
PlanAgent (LLM, conditional) ↓
FinalizeAgent (LLM)

| Order | Agent              | Role                                             |
| ----- | ------------------ | ------------------------------------------------ |
| 1     | CheckApprovalAgent | Classify message intent (approval vs refinement) |
| 2     | PlanAgent          | Generate or refine plan JSON                     |
| 3     | FinalizeAgent      | Compose structured reply and next action         |

────────────────────────────────────────────

🔷 7️⃣ LLM Agent Definitions

### 🔹 CheckApprovalAgent

**Type:** `LlmAgent`

**Instruction:**

> Analyze the user's message and decide if it indicates goal plan approval or refinement. Use conversation context to reason. Output a JSON object with fields:
>
> * `routing`: 'finalize_only' or 'needs_planning'
> * `detectedConsent`: boolean
> * `reason`: short reasoning string.

**Output Key:** `approval_decision`

Additionally, store the latest user message into the session context for reference:

```python
ctx.session.state["user_goal_text"] = ctx.input.message
```

Example Output:

```json
{
  "routing": "finalize_only",
  "detectedConsent": true,
  "reason": "The user said 'Looks good', indicating approval."
}
```

Post-processing:

```python
ctx.session.state.update({
  "routing": decision["routing"],
  "detectedConsent": decision["detectedConsent"]
})
```

---

### 🔹 PlanAgent

**Type:** `LlmAgent`

**Instruction:**

> Generate or refine a structured plan following Gritto's GoalPreview schema. If state['proposed_plan'] is empty, create a new one; otherwise, adjust the existing plan. The user’s most recent input is available in `state['user_goal_text']` and should be considered for updates. Always output valid JSON conforming to the GoalPreview model.

**Output Key:** `proposed_plan`

Example Output:

```json
{
  "goal": { "title": "Build Portfolio Website" },
  "milestones": [ { "title": "Design Phase", "tasks": [] } ],
  "iteration": 2
}
```

---

### 🔹 FinalizeAgent

**Type:** `LlmAgent`

**Instruction:**

> Generate the final user-facing reply and backend action. Use session.state.routing, proposed_plan, and user_goal_text to decide whether to save or finalize. Output must be a JSON object with:
>
> * `reply`: string
> * `action`: object with `type` and `payload`
> * `state`: object with step, iteration, sessionActive.

**Output Key:** `final_response`

Example Output:

```json
{
  "reply": "I've created a goal for you: Build Portfolio Website 🎯",
  "action": {
    "type": "finalize_goal",
    "payload": {
      "goalPreviewId": "gp_123",
      "goal": { "title": "Build Portfolio Website" },
      "milestones": []
    }
  },
  "state": { "step": "finalized", "sessionActive": false }
}
```

────────────────────────────────────────────

📊 8️⃣ Response Contract Summary

| Field            | Type   | Description                       |
| ---------------- | ------ | --------------------------------- |
| `reply`          | string | Final message for the user        |
| `action.type`    | string | `save_preview` or `finalize_goal` |
| `action.payload` | object | Structured plan or goal data      |
| `state`          | object | Updated session state for backend |

────────────────────────────────────────────

💬 9️⃣ Example Message Flows

**Case 1 — User starts a new goal**

Agents: CheckApproval (needs_planning) → PlanAgent → FinalizeAgent

Output:

```json
{
  "reply": "Here’s a plan based on your message!",
  "action": { "type": "save_preview", "payload": { ... } },
  "state": { "step": "plan_generated", "iteration": 1, "sessionActive": true }
}
```

---

**Case 2 — User refines existing plan**

Agents: CheckApproval (needs_planning) → PlanAgent → FinalizeAgent

Output:

```json
{
  "reply": "I’ve updated your plan as requested.",
  "action": {
    "type": "save_preview",
    "payload": {
      "goalPreview": { "goal": { "title": "Build Portfolio Website" }, "iteration": 2 }
    }
  },
  "state": { "step": "plan_iteration", "iteration": 2, "sessionActive": true }
}
```

---

**Case 3 — User approves the plan**

Agents: CheckApproval (finalize_only) → FinalizeAgent

Output:

```json
{
  "reply": "I've created a goal for you: Learn Kotlin 🎯",
  "action": { "type": "finalize_goal", "payload": { ... } },
  "state": { "step": "finalized", "sessionActive": false }
}
```

---

**Case 4 — User refines plan and approval detected in follow-up message**

Input: "Let's finalize this version of the design phase."

Agents: CheckApproval (detectedConsent: true) → FinalizeAgent

Output:

```json
{
  "reply": "Understood! I’ll save your final plan now.",
  "action": {
    "type": "finalize_goal",
    "payload": {
      "goalPreviewId": "gp_459",
      "goal": { "title": "Build Portfolio Website" },
      "milestones": [ { "title": "Design Phase", "tasks": [] } ]
    }
  },
  "state": { "step": "finalized", "sessionActive": false }
}
```

---

**Case 5 — User refines plan mid-conversation (no consent)**

Input: "Can you move the first milestone to next week?"

Agents: CheckApproval (needs_planning) → PlanAgent → FinalizeAgent

Output:

```json
{
  "reply": "Got it! I’ve shifted your first milestone to next week.",
  "action": {
    "type": "save_preview",
    "payload": {
      "goalPreview": { "goal": { "title": "Build Portfolio Website" }, "iteration": 3 }
    }
  },
  "state": { "step": "plan_iteration", "iteration": 3, "sessionActive": true }
}
```

────────────────────────────────────────────

📈 10️⃣ Summary

| Layer          | Role                                                |
| -------------- | --------------------------------------------------- |
| Agent Server   | Stateless reasoning engine producing JSON responses |
| Backend Server | Executes actions and persists data in Firestore     |
| Client App     | Displays replies and previews goal plan data        |

All LLM agents now produce **schema-validated JSON**, maintaining Cloud Run reliability while improving conversational quality and reasoning depth.

────────────────────────────────────────────

End of Document — LLM-Enhanced Gritto Agent Workflow Spec
