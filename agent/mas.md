🤖 Gritto Agent Service — Design & Implementation Spec

(Final ADK Cloud Run Version — Context-Persistent LLM Agents on Cloud Run)

Scope

Defines the architecture and reasoning flow of the Gritto Goal Planning Agent Service, a multi-agent workflow that generates, refines, and finalizes structured goal plans with full session-state context persistence.
It is implemented using Google’s Agent Development Kit (ADK) and deployed on Google Cloud Run.

⸻

🧩 1️⃣ System Architecture

Client (KMP App)
   │
   ▼
Backend (TypeScript / Express)
   │
   ├─ /v1/agent/goal/session:message
   │    ├─ ensures valid session
   │    ├─ passes user message only (context is persisted)
   │    └─ sends → POST {AGENT_APP_URL}/run
   ▼
──────────────────────────────────────────────
Gritto Agent Service (Python / ADK)
│
├── GoalPlanningWorkflow (SequentialAgent)
│    ├── CheckApprovalAgent (LLM)
│    ├── PlanAgent (LLM)
│    └── FinalizeAgent (LLM)
│
└── Persistent Session Store (SQLite / SQL / Firestore)
     • Restores ctx.state across sessions
     • Stores goalPreview, availableHours, upcomingTasks
──────────────────────────────────────────────


⸻

🌐 2️⃣ Exposed Endpoints

A) Initialize Remote Session

POST {AGENT_APP_URL}/apps/goal_planning_agent/users/{userId}/sessions/{sessionId}

{
  "preferred_language": "English",
  "init": true
}

B) Execute Reasoning Step

POST {AGENT_APP_URL}/run

The backend sends only the new user message; context is retrieved automatically from the persisted session state.

⸻

📦 3️⃣ Input Schema (Backend → Agent)

{
  "app_name": "goal_planning_agent",
  "user_id": "u_001",
  "session_id": "sess_goal_001",
  "new_message": {
    "role": "user",
    "parts": [
      { "text": "Move the design phase to next week, and don’t overlap with team meetings." }
    ]
  }
}

Backend does not resend context each time.
The agent automatically restores:

ctx.state["goalPreview"]
ctx.state["availableHoursLeft"]
ctx.state["upcomingTasks"]


⸻

📤 4️⃣ Standard Output

{
  "reply": "string",
  "action": {
    "type": "save_preview" | "finalize_goal" | "none",
    "payload": { "goalDraft": { ...structured data... } }
  },
  "state": {
    "step": "plan_generated" | "plan_iteration" | "finalized",
    "iteration": 1,
    "sessionActive": true
  }
}


⸻

⚙️ 5️⃣ Core Logic Overview

Function	Description
CheckApprovalAgent	Detects whether user approves the current plan or requests changes.
PlanAgent	Revises or generates a plan using stored context (goalPreview, hours left, upcoming tasks).
FinalizeAgent	Confirms and outputs the final goal plan with structured JSON.
Session Manager	Persists ctx.state in the session database (restored on every run).


⸻

🧠 6️⃣ Context Model (Persisted Across Sessions)

Each agent workflow uses ctx.state for durable memory.

Key	Type	Description
goalPreview	object	Previous goal draft or latest refined version.
availableHoursLeft	number	Remaining hours available for the current planning window.
upcomingTasks	list	Scheduled tasks (with timestamps, durations) to avoid conflicts.

These are initialized during the first planning step and restored automatically on all subsequent agent calls.

⸻

🔵 7️⃣ CheckApprovalAgent (LLM-Powered)

from google.adk.agents import LlmAgent

CheckApprovalAgent = LlmAgent(
    name="CheckApprovalAgent",
    instruction=(
        "Analyze the user's message and the existing goal plan (ctx.state['goalPreview']) "
        "to determine intent. Output JSON with keys: "
        "{ 'routing': 'finalize_only' | 'needs_planning', 'detectedConsent': true|false }. "
        "'finalize_only' means the user approves or confirms the plan. "
        "'needs_planning' means refinement, update, or new plan creation is needed."
    ),
    output_key="routing"
)

Example Output

{ "routing": "needs_planning", "detectedConsent": false }


⸻

🟢 8️⃣ PlanAgent (LLM-Powered + Context-Bound Reasoning)

PlanAgent = LlmAgent(
    name="PlanAgent",
    instruction=(
        "You are a goal planning assistant. You have full context via ctx.state, including: "
        "- ctx.state['goalPreview']: the user's current or previous goal plan. "
        "- ctx.state['availableHoursLeft']: total time remaining for scheduling. "
        "- ctx.state['upcomingTasks']: existing future tasks (must not overlap). "
        "\n\n"
        "TASK: Use this context to generate or refine a structured goal plan JSON under 'goalDraft'. "
        "Rules:\n"
        "1. Respect availableHoursLeft — total estimatedHours across all tasks must not exceed it.\n"
        "2. Avoid conflicts — new or rescheduled tasks must not overlap with upcomingTasks.\n"
        "3. When goalPreview exists, update or refine it instead of starting from scratch.\n"
        "4. Always output a valid JSON object under key 'goalDraft' following the GoalPreview schema."
    ),
    output_key="proposed_plan"
)

📋 Required Output Schema

{
  "goalDraft": {
    "title": "string",
    "description": "string (optional)",
    "milestones": [
      {
        "title": "string",
        "description": "string (optional)",
        "tasks": [
          {
            "title": "string",
            "description": "string (optional)",
            "date": "Timestamp",
            "estimatedHours": "number"
          }
        ]
      }
    ]
  }
}

✅ LLM Guidance:
	•	Use ctx.state['goalPreview'] when revising an existing plan.
	•	Do not exceed total available hours (ctx.state['availableHoursLeft']).
	•	Avoid all time overlaps with ctx.state['upcomingTasks'].
	•	Ensure the JSON is strictly valid, ready for backend persistence.

⸻

🟡 9️⃣ FinalizeAgent (LLM-Powered)

FinalizeAgent = LlmAgent(
    name="FinalizeAgent",
    instruction=(
        "Based on routing and proposed plan in ctx.state, craft a user-facing summary message "
        "and structured JSON under 'final_output'.\n"
        "If routing == 'finalize_only', create a 'finalize_goal' action: "
        "{ 'type': 'finalize_goal', 'payload': { 'goalDraft': ctx.state['goalPreview'] } }.\n"
        "If routing == 'needs_planning', create a 'save_preview' action: "
        "{ 'type': 'save_preview', 'payload': { 'goalDraft': ctx.state['goalPreview'], 'iteration': iteration+1 } }.\n"
        "Always ensure the payload follows the GoalDraft schema and the response is valid JSON "
        "with keys: reply, action, and state."
    ),
    output_key="final_output"
)

Example Output

{
  "reply": "I've refined your plan and ensured no conflicts with your calendar.",
  "action": {
    "type": "save_preview",
    "payload": {
      "goalDraft": { "title": "Build Portfolio Website", "milestones": [...] },
      "iteration": 2
    }
  },
  "state": { "step": "plan_generated", "iteration": 2, "sessionActive": true }
}


⸻

🧾 10️⃣ Response Contract Summary

Field	Type	Description
reply	string	LLM’s user-facing message
action.type	"save_preview", "finalize_goal", or "none"	Next persistence action
action.payload	object	Structured goalDraft JSON
state	object	Updated iteration and session flags


⸻

🔒 11️⃣ Security
	•	All requests authenticated via Cloud Run IAM identity tokens
	•	Only backend Cloud Run instance can call /run
	•	Session state managed by ADK session service (SQL/Firestore)
	•	Validation for user_id and session_id enforced in backend layer

⸻

✅ 12️⃣ Summary

Layer	Responsibility
Agent Service	Stateless compute with context persistence in session DB
Backend	Session + context management; saving previews and goals
Frontend	Chat interface and goal visualization


⸻

💬 Example End-to-End

1️⃣ User Input

“Add a testing milestone next week, but keep total hours within 20.”

2️⃣ Backend → Agent
	•	Sends only the message and session_id.
	•	Context (goalPreview, hours, tasks) auto-restored via ctx.state.

3️⃣ Agent Output

{
  "reply": "Added a new testing milestone next week, keeping your workload within 18 available hours.",
  "action": {
    "type": "save_preview",
    "payload": {
      "goalDraft": {
        "title": "Build Portfolio Website",
        "milestones": [
          { "title": "Testing Phase", "tasks": [{ "title": "Integration Test", "date": "2025-11-17", "estimatedHours": 4 }] }
        ]
      },
      "iteration": 3
    }
  },
  "state": { "step": "plan_iteration", "sessionActive": true }
}


⸻

End of Document — Gritto Agent Implementation Spec (Context-Bound LLM Agents with Time & Conflict Constraints)