🤖 Gritto Agent Service — Design & Implementation Spec

Scope

This document defines the architecture and interface of the Gritto Python Agent Service, which powers goal planning and reasoning for the Gritto app.
It is a standalone Cloud Run microservice, invoked by the backend via POST /agent/run.

⸻

🧩 1️⃣ System Architecture

Client (Mobile App)
   │
   ▼
Backend (TypeScript / Express)
   │
   │  POST /agent/run
   ▼
────────────────────────────────────────────
Gritto Agent Service (Python / ADK)
│
├── GoalPlanningWorkflow (SequentialAgent)
│    ├── CheckApprovalAgent
│    ├── PlanAgent
│    └── FinalizeAgent
│
└── Returns structured JSON:
     {
       "reply": "...",
       "action": { "type": "...", "payload": {...} },
       "state": {...}
     }
────────────────────────────────────────────

Purpose:
The agent interprets user input, generates/refines structured goal plans, and outputs reasoning results and action intents (save_preview / finalize_goal) for the backend to persist.

⸻

🌐 2️⃣ Exposed Endpoint

POST /agent/run

Property	Description
Purpose	Execute one conversational reasoning step in the Goal Planning workflow.
Consumes	JSON input containing user message, context, and current session state.
Produces	Structured JSON output with reply, action, and state fields.
Invocation	Called exclusively by backend Cloud Run (not by clients directly).


⸻

⚙️ 3️⃣ Main Functionality

Function	Description
1️⃣ Interpret user input	Detects whether user is approving, refining, or starting a new plan.
2️⃣ Generate/refine plan	Uses an LLM (Gemini / Gemma) to produce structured plan JSON conforming to Gritto’s GoalPreview model.
3️⃣ Summarize and route actions	Returns the proper message and action type for the backend to execute (save_preview, finalize_goal).
4️⃣ State management	Updates session lifecycle state (step, iteration, sessionActive) deterministically.


⸻

📥 4️⃣ Expected Input Format

{
  "userId": "u_001",
  "sessionId": "sess_goal_001",
  "message": "Can you move the design phase to next week?",
  "context": {
    "existingGoals": [
      { "id": "g_01", "title": "Learn Kotlin" }
    ],
    "calendarEvents": [
      { "title": "Work Meeting", "start": "2025-11-03T14:00:00Z", "end": "2025-11-03T15:00:00Z" }
    ]
  },
  "state": {
    "step": "plan_generated",
    "iteration": 1,
    "sessionActive": true,
    "proposed_plan": {
      "goal": { "title": "Build Portfolio Website" },
      "milestones": [
        { "title": "Design Phase", "tasks": [] }
      ]
    }
  }
}


⸻

📤 5️⃣ Standard Output Format

Every response must follow this schema:

{
  "reply": "string (agent's message to user)",
  "action": {
    "type": "save_preview" | "finalize_goal" | "none",
    "payload": { "structured": "data depending on type" }
  },
  "state": {
    "step": "plan_generated" | "plan_iteration" | "finalized",
    "iteration": "number",
    "sessionActive": "boolean"
  }
}


⸻

🧠 6️⃣ Internal Agent Workflow

Workflow: GoalPlanningWorkflow (SequentialAgent)

CheckApprovalAgent
     ↓
PlanAgent (only if needed)
     ↓
FinalizeAgent

Order	Agent	Purpose
1️⃣	CheckApprovalAgent	Classifies message intent: user approval vs refinement.
2️⃣	PlanAgent	Generates or refines structured goal plan if needed.
3️⃣	FinalizeAgent	Composes reply, determines next action type, and updates state.


⸻

🔍 7️⃣ Agent Definitions

🟣 CheckApprovalAgent

Role:
Decide if the user message indicates approval (finalize_only) or needs planning (needs_planning).

Input (from session.state):

{ "user_goal_text": "Looks good!", "proposed_plan": { ... } }

Output (to session.state):

{ "routing": "finalize_only", "detectedConsent": true }

Pseudocode:

class CheckApprovalAgent(BaseAgent):
    async def _run_async_impl(self, ctx):
        s = ctx.session.state
        text = (s.get("user_goal_text") or "").lower()
        has_plan = bool(s.get("proposed_plan"))

        positives = ["approve", "looks good", "yes", "okay", "save", "go ahead"]
        negators = ["but", "however", "not yet", "change", "adjust", "later"]

        positive = any(p in text for p in positives)
        negative = any(n in text for n in negators)
        s["detectedConsent"] = positive and not negative
        s["routing"] = "finalize_only" if s["detectedConsent"] and has_plan else "needs_planning"

        yield Event(author=self.name, content=f"Decision: {s['routing']}")


⸻

🟢 PlanAgent

Role:
Generate a new structured plan or refine an existing one using an LLM (Gemini / Gemma).

Input:

{ "routing": "needs_planning", "proposed_plan": { ...optional... } }

Output:

{ "proposed_plan": { "goal": {...}, "milestones": [...], "iteration": 2 } }

LLM Instruction Example:

“If session.state[‘proposed_plan’] is empty, create a new structured goal plan following Gritto’s GoalPreview model.
If it exists, refine it based on the latest user input.
Always output valid JSON conforming to the model.”

Pseudocode:

PlanAgent = LlmAgent(
    name="PlanAgent",
    instruction="Generate or refine structured plan JSON according to Gritto GoalPreview schema.",
    output_key="proposed_plan"
)


⸻

🟡 FinalizeAgent

Role:
Generate the agent’s final message and an action payload that the backend will interpret and persist.

Input:

{
  "routing": "finalize_only",
  "proposed_plan": { ... },
  "iteration": 1
}

Output (example for refinement):

{
  "reply": "I’ve updated your plan as requested.",
  "action": {
    "type": "save_preview",
    "payload": { "goalPreview": {...}, "iteration": 2 }
  },
  "state": { "step": "plan_iteration", "iteration": 2, "sessionActive": true }
}

Output (example for approval):

{
  "reply": "I've created a goal for you: Build Portfolio Website 🎯",
  "action": {
    "type": "finalize_goal",
    "payload": {
      "goalPreviewId": "gp_456",
      "goal": { "title": "Build Portfolio Website" },
      "milestones": [...]
    }
  },
  "state": { "step": "finalized", "sessionActive": false }
}

Pseudocode:

class FinalizeAgent(BaseAgent):
    async def _run_async_impl(self, ctx):
        s = ctx.session.state
        plan = s.get("proposed_plan")
        routing = s.get("routing")
        iteration = s.get("iteration", 0)
        reply, action = "", {}

        if routing == "finalize_only":
            reply = f"I've created a goal for you: {plan['goal']['title']} 🎯"
            action = {
                "type": "finalize_goal",
                "payload": {
                    "goalPreviewId": plan.get("id"),
                    "goal": plan["goal"],
                    "milestones": plan.get("milestones", [])
                }
            }
            s.update({"step": "finalized", "sessionActive": False})
        else:
            iteration += 1
            s.update({"iteration": iteration, "step": "plan_iteration", "sessionActive": True})
            reply = "Here’s a plan based on your message!" if iteration == 1 else "I’ve updated your plan as requested."
            action = {
                "type": "save_preview",
                "payload": { "goalPreview": plan, "iteration": iteration }
            }

        yield Event(author=self.name, content=reply, actions={"metadata": {"action": action}})


⸻

🧾 8️⃣ Response Contract Summary

Field	Type	Description
reply	string	The final text message for the user.
action.type	`“save_preview”	“finalize_goal”
action.payload	object	Structured data (GoalPreview JSON or finalized goal details).
state	object	Updated session state for backend to persist.


⸻

💬 9️⃣ Example Message Walkthroughs

Case 1 — User starts a new plan (no consent signal, no plan)

Input:

“I want to learn Kotlin.”

Agents run:
CheckApproval (needs_planning) → PlanAgent → FinalizeAgent

Output:

{
  "reply": "Here’s a plan based on your message!",
  "action": {
    "type": "save_preview",
    "payload": { "goalPreview": {...}, "iteration": 1 }
  },
  "state": { "step": "plan_generated", "iteration": 1, "sessionActive": true }
}


⸻

Case 2 — User refines existing plan

Input:

“Can you add a milestone for mobile design?”

Agents run:
CheckApproval (needs_planning) → PlanAgent → FinalizeAgent

Output:

{
  "reply": "I’ve updated your plan as requested.",
  "action": {
    "type": "save_preview",
    "payload": { "goalPreview": {...}, "iteration": 2 }
  },
  "state": { "step": "plan_iteration", "iteration": 2, "sessionActive": true }
}


⸻

Case 3 — User approves the plan

Input:

“Looks good!”

Agents run:
CheckApproval (finalize_only) → FinalizeAgent

Output:

{
  "reply": "I've created a goal for you: Learn Kotlin 🎯",
  "action": {
    "type": "finalize_goal",
    "payload": { "goalPreviewId": "gp_101", "goal": {...}, "milestones": [...] }
  },
  "state": { "step": "finalized", "sessionActive": false }
}


⸻

Case 4 — Post-finalization (new goal start)

Input:

“Now I want to start learning Flutter.”

Agents run:
CheckApproval (needs_planning) → PlanAgent → FinalizeAgent

Output:

{
  "reply": "Here’s a plan based on your new message!",
  "action": {
    "type": "save_preview",
    "payload": { "goalPreview": {...}, "iteration": 1 }
  },
  "state": { "step": "plan_generated", "iteration": 1, "sessionActive": true }
}


⸻

✅ 10️⃣ Summary

Layer	Role
Agent Server	Stateless reasoning engine that decides “what to do next.”
Backend Server	Executes actions, persists results, manages Firestore and sessions.
Client App	Displays reply, previews plan data, and continues conversation.

The agent never writes to the database directly — it only returns structured actions describing what should happen.

⸻

End of Document — Gritto Agent Implementation Spec (Codex Reference)