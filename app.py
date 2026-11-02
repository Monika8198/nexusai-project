
from flask import Flask, request, jsonify, render_template
from database import get_connection
from google import genai
from dotenv import load_dotenv
from datetime import date, time
import os
import json
import re

# =========================
# LOAD ENVIRONMENT VARIABLES
# =========================

load_dotenv()

app = Flask(__name__)

USER_ID = 7
GEMINI_MODEL = "gemini-3.5-flash-lite"

# =========================
# GEMINI AI
# =========================

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)


# =========================
# MEMORY HELPERS
# =========================

def get_saved_memories():
    """Retrieve saved memories for the current user."""

    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute("""
            SELECT memory_id, memory_text, created_at
            FROM memory
            WHERE user_id = %s
            ORDER BY memory_id DESC
        """, (USER_ID,))

        return cursor.fetchall()

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


def save_memory(memory_text):
    """Save a memory only if the same text is not already present."""

    if not isinstance(memory_text, str):
        return False

    memory_text = memory_text.strip()

    if not memory_text or len(memory_text) > 2000:
        return False

    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor()

        cursor.execute("""
            SELECT memory_id
            FROM memory
            WHERE user_id = %s AND memory_text = %s
            LIMIT 1
        """, (USER_ID, memory_text))

        if cursor.fetchone():
            return False

        cursor.execute("""
            INSERT INTO memory (user_id, memory_text)
            VALUES (%s, %s)
        """, (USER_ID, memory_text))

        db.commit()
        return True

    except Exception:
        if db is not None:
            db.rollback()
        raise

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


def extract_memories(user_message):
    """
    Ask Gemini to identify useful, durable, non-sensitive facts
    explicitly stated by the user.
    """

    prompt = f"""
Identify any useful long-term facts explicitly stated by the user
in the message below.

Save only facts that may help in future conversations, such as:
- Learning goals and ongoing projects
- Study or work preferences
- Preferred programming languages or tools
- Stable preferences the user explicitly mentions

Do NOT save:
- Temporary requests or ordinary questions
- Guesses, assumptions, or facts inferred about the user
- Passwords, API keys, authentication codes, or other secrets
- Sensitive personal information, including health details,
  financial details, religious beliefs, or precise location
- Information about other people unless clearly necessary

Convert useful facts into short, standalone sentences.
Do not rewrite existing facts or invent details.

Return ONLY valid JSON in this format:
{{"memories": ["fact one", "fact two"]}}

If there are no suitable facts, return:
{{"memories": []}}

User message:
{user_message}
"""

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt
    )

    text = response.text or ""
    text = text.strip()

    # Handle a JSON response wrapped in Markdown fences.
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    result = json.loads(text)
    memories = result.get("memories", [])

    if not isinstance(memories, list):
        return []

    return [
        item.strip()
        for item in memories
        if isinstance(item, str) and item.strip()
    ]


def format_memories_for_ai(memories):
    """Prepare saved memories for SERA's prompt."""

    if not memories:
        return "No saved memories are available."

    return "\n".join(
        f"- {item['memory_text']}"
        for item in memories
    )


# =========================
# HOME PAGE
# =========================

@app.route("/")
def home():
    return render_template("index.html")


# =========================
# CHAT WITH MEMORY
# =========================

@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    user_message = data.get("message")

    if not isinstance(user_message, str) or not user_message.strip():
        return jsonify({"error": "Message is required"}), 400

    user_message = user_message.strip()

    try:
        # Load the user's saved memories.
        saved_memories = get_saved_memories()
        memory_context = format_memories_for_ai(saved_memories)

        system_instruction = f"""
You are SERA, the intelligent AI companion inside Nexus AI.

Your name is SERA.
Always identify yourself as SERA when asked your name.
Do not say that you are Gemini or a Google language model.
Be helpful, clear, friendly, and concise.

The following are saved facts explicitly provided by the user.
Use them only when relevant to the current conversation.
Do not assume these facts are complete or permanently current.
If a fact appears outdated, ask the user rather than assuming.

SAVED USER MEMORIES:
{memory_context}

Never claim that you saved or deleted a memory unless the
application actually confirms that action.
"""

        # Generate SERA's answer using saved memories.
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            config={
                "system_instruction": system_instruction
            },
            contents=user_message
        )

        ai_response = response.text

        if not ai_response:
            return jsonify({
                "error": "SERA could not generate a response. Please try again."
            }), 502

        # Save the conversation.
        db = None
        cursor = None

        try:
            db = get_connection()
            cursor = db.cursor()

            cursor.execute("""
                INSERT INTO chat_history
                    (user_id, user_message, ai_response)
                VALUES (%s, %s, %s)
            """, (USER_ID, user_message, ai_response))

            db.commit()

        finally:
            if cursor is not None:
                cursor.close()
            if db is not None:
                db.close()

        # Extract and save memories separately.
        # If memory extraction fails, the chat still succeeds.
        memories_saved = 0

        try:
            extracted_memories = extract_memories(user_message)

            for memory_text in extracted_memories:
                if save_memory(memory_text):
                    memories_saved += 1

        except Exception:
            app.logger.exception("Memory extraction failed")

        return jsonify({
            "message": user_message,
            "response": ai_response,
            "memories_saved": memories_saved
        })

    except Exception:
        app.logger.exception("Chat request failed")
        return jsonify({
            "error": "SERA encountered a problem. Please try again."
        }), 500


# =========================
# MEMORY - GET ALL
# =========================

@app.route("/memory", methods=["GET"])
def get_memories():
    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute("""
            SELECT memory_id, memory_text, created_at
            FROM memory
            WHERE user_id = %s
            ORDER BY memory_id DESC
        """, (USER_ID,))

        memories = cursor.fetchall()

        for item in memories:
            if item["created_at"] is not None:
                item["created_at"] = item["created_at"].isoformat()

        return jsonify({
            "success": True,
            "memories": memories
        })

    except Exception:
        app.logger.exception("Failed to fetch memories")
        return jsonify({
            "success": False,
            "error": "Could not load memories"
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# MEMORY - ADD MANUALLY
# =========================

@app.route("/memory", methods=["POST"])
def add_memory():
    data = request.get_json(silent=True) or {}
    memory_text = data.get("memory_text")

    if not isinstance(memory_text, str) or not memory_text.strip():
        return jsonify({
            "success": False,
            "error": "Memory text is required"
        }), 400

    memory_text = memory_text.strip()

    if len(memory_text) > 2000:
        return jsonify({
            "success": False,
            "error": "Memory must be 2000 characters or fewer"
        }), 400

    try:
        was_saved = save_memory(memory_text)

        if not was_saved:
            return jsonify({
                "success": True,
                "message": "This memory already exists",
                "saved": False
            })

        return jsonify({
            "success": True,
            "message": "Memory saved successfully",
            "saved": True
        }), 201

    except Exception:
        app.logger.exception("Failed to add memory")
        return jsonify({
            "success": False,
            "error": "Could not save memory"
        }), 500


# =========================
# MEMORY - DELETE
# =========================

@app.route("/memory/<int:memory_id>", methods=["DELETE"])
def delete_memory(memory_id):
    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor()

        cursor.execute("""
            DELETE FROM memory
            WHERE memory_id = %s AND user_id = %s
        """, (memory_id, USER_ID))

        deleted_count = cursor.rowcount
        db.commit()

        if deleted_count == 0:
            return jsonify({
                "success": False,
                "error": "Memory not found"
            }), 404

        return jsonify({
            "success": True,
            "message": "Memory deleted successfully"
        })

    except Exception:
        if db is not None:
            db.rollback()

        app.logger.exception("Failed to delete memory")

        return jsonify({
            "success": False,
            "error": "Could not delete memory"
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# TASKS - GET ALL
# =========================

@app.route("/tasks", methods=["GET"])
def get_tasks():
    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute("""
            SELECT task_id, user_id, title, description,
                   due_date, priority, status
            FROM tasks
            WHERE user_id = %s
            ORDER BY task_id DESC
        """, (USER_ID,))

        tasks = cursor.fetchall()

        for task in tasks:
            if task["due_date"] is not None:
                task["due_date"] = task["due_date"].isoformat()

        return jsonify({"tasks": tasks})

    except Exception:
        app.logger.exception("Failed to fetch tasks")
        return jsonify({"error": "Could not load tasks"}), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# TASKS - CREATE
# =========================

@app.route("/tasks", methods=["POST"])
def create_task():
    data = request.get_json(silent=True) or {}

    title = data.get("title")
    description = data.get("description") or None
    due_date = data.get("due_date") or None
    priority = data.get("priority", "medium")

    if not isinstance(title, str) or not title.strip():
        return jsonify({"error": "Task title is required"}), 400

    title = title.strip()

    if description is not None and not isinstance(description, str):
        return jsonify({"error": "Description must be text"}), 400

    if isinstance(description, str):
        description = description.strip() or None

    if priority not in ("low", "medium", "high"):
        return jsonify({
            "error": "Priority must be low, medium, or high"
        }), 400

    if due_date:
        if not isinstance(due_date, str):
            return jsonify({"error": "Invalid due date"}), 400

        try:
            date.fromisoformat(due_date)
        except ValueError:
            return jsonify({
                "error": "Due date must use YYYY-MM-DD format"
            }), 400

    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor()

        cursor.execute("""
            INSERT INTO tasks
                (user_id, title, description, due_date, priority, status)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (USER_ID, title, description, due_date, priority, "pending"))

        db.commit()

        return jsonify({
            "message": "Task created successfully",
            "task_id": cursor.lastrowid
        }), 201

    except Exception:
        if db is not None:
            db.rollback()

        app.logger.exception("Failed to create task")
        return jsonify({"error": "Could not create task"}), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# TASKS - EDIT
# =========================

@app.route("/tasks/<int:task_id>", methods=["PUT"])
def edit_task(task_id):
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "Invalid task data"}), 400

    title = data.get("title")
    description = data.get("description")
    due_date = data.get("due_date")
    priority = data.get("priority")

    if not isinstance(title, str) or not title.strip():
        return jsonify({"error": "Task title is required"}), 400

    title = title.strip()

    if description is not None and not isinstance(description, str):
        return jsonify({"error": "Description must be text"}), 400

    if isinstance(description, str):
        description = description.strip() or None

    if due_date == "":
        due_date = None

    if due_date is not None:
        if not isinstance(due_date, str):
            return jsonify({"error": "Invalid due date"}), 400

        try:
            date.fromisoformat(due_date)
        except ValueError:
            return jsonify({
                "error": "Due date must use YYYY-MM-DD format"
            }), 400

    if priority not in ("low", "medium", "high"):
        return jsonify({
            "error": "Priority must be low, medium, or high"
        }), 400

    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor()

        cursor.execute("""
            UPDATE tasks
            SET title = %s, description = %s,
                due_date = %s, priority = %s
            WHERE task_id = %s AND user_id = %s
        """, (title, description, due_date, priority, task_id, USER_ID))

        updated_count = cursor.rowcount
        db.commit()

        if updated_count == 0:
            cursor.execute("""
                SELECT task_id FROM tasks
                WHERE task_id = %s AND user_id = %s
            """, (task_id, USER_ID))

            if cursor.fetchone() is None:
                return jsonify({"error": "Task not found"}), 404

        return jsonify({
            "message": "Task updated successfully",
            "task_id": task_id
        })

    except Exception:
        if db is not None:
            db.rollback()

        app.logger.exception("Failed to edit task")
        return jsonify({"error": "Could not edit task"}), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# TASKS - UPDATE STATUS
# =========================

@app.route("/tasks/<int:task_id>", methods=["PATCH"])
def update_task_status(task_id):
    data = request.get_json(silent=True) or {}
    status = data.get("status")

    if status not in ("pending", "completed"):
        return jsonify({
            "error": "Status must be pending or completed"
        }), 400

    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor()

        cursor.execute("""
            UPDATE tasks
            SET status = %s
            WHERE task_id = %s AND user_id = %s
        """, (status, task_id, USER_ID))

        updated_count = cursor.rowcount
        db.commit()

        if updated_count == 0:
            cursor.execute("""
                SELECT task_id FROM tasks
                WHERE task_id = %s AND user_id = %s
            """, (task_id, USER_ID))

            if cursor.fetchone() is None:
                return jsonify({"error": "Task not found"}), 404

        return jsonify({
            "message": "Task status updated successfully",
            "task_id": task_id,
            "status": status
        })

    except Exception:
        if db is not None:
            db.rollback()

        app.logger.exception("Failed to update task status")
        return jsonify({"error": "Could not update task status"}), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# TASKS - DELETE
# =========================

@app.route("/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor()

        cursor.execute("""
            DELETE FROM tasks
            WHERE task_id = %s AND user_id = %s
        """, (task_id, USER_ID))

        deleted_count = cursor.rowcount
        db.commit()

        if deleted_count == 0:
            return jsonify({"error": "Task not found"}), 404

        return jsonify({
            "message": "Task deleted successfully",
            "task_id": task_id
        })

    except Exception:
        if db is not None:
            db.rollback()

        app.logger.exception("Failed to delete task")
        return jsonify({"error": "Could not delete task"}), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# REMINDERS - GET ALL
# =========================

@app.route("/reminders", methods=["GET"])
def get_reminders():
    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute("""
            SELECT reminder_id, title, reminder_date, reminder_time
            FROM reminders
            WHERE user_id = %s
            ORDER BY reminder_date, reminder_time
        """, (USER_ID,))

        reminders = cursor.fetchall()

        for reminder in reminders:
            if reminder["reminder_date"]:
                reminder["reminder_date"] = (
                    reminder["reminder_date"].isoformat()
                )

            if reminder["reminder_time"]:
                reminder["reminder_time"] = str(reminder["reminder_time"])

        return jsonify({
            "success": True,
            "reminders": reminders
        })

    except Exception:
        app.logger.exception("Failed to fetch reminders")
        return jsonify({
            "success": False,
            "error": "Could not load reminders"
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# REMINDERS - CREATE
# =========================

@app.route("/reminders", methods=["POST"])
def add_reminder():
    data = request.get_json(silent=True) or {}

    title = data.get("title")
    reminder_date = data.get("reminder_date")
    reminder_time = data.get("reminder_time")

    if not isinstance(title, str) or not title.strip():
        return jsonify({
            "success": False,
            "error": "Reminder title is required"
        }), 400

    if not isinstance(reminder_date, str) or not isinstance(reminder_time, str):
        return jsonify({
            "success": False,
            "error": "Valid reminder date and time are required"
        }), 400

    title = title.strip()

    try:
        parsed_date = date.fromisoformat(reminder_date)
        parsed_time = time.fromisoformat(reminder_time)
        normalized_time = parsed_time.strftime("%H:%M:%S")

    except ValueError:
        return jsonify({
            "success": False,
            "error": "Use date YYYY-MM-DD and time HH:MM"
        }), 400

    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor()

        cursor.execute("""
            INSERT INTO reminders
                (user_id, title, reminder_date, reminder_time)
            VALUES (%s, %s, %s, %s)
        """, (USER_ID, title, parsed_date, normalized_time))

        db.commit()

        return jsonify({
            "success": True,
            "message": "Reminder saved successfully",
            "reminder_id": cursor.lastrowid
        }), 201

    except Exception:
        if db is not None:
            db.rollback()

        app.logger.exception("Failed to create reminder")
        return jsonify({
            "success": False,
            "error": "Could not save reminder"
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# REMINDERS - DELETE
# =========================

@app.route("/reminders/<int:reminder_id>", methods=["DELETE"])
def delete_reminder(reminder_id):
    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor()

        cursor.execute("""
            DELETE FROM reminders
            WHERE reminder_id = %s AND user_id = %s
        """, (reminder_id, USER_ID))

        deleted_count = cursor.rowcount
        db.commit()

        if deleted_count == 0:
            return jsonify({
                "success": False,
                "error": "Reminder not found"
            }), 404

        return jsonify({
            "success": True,
            "message": "Reminder deleted successfully"
        })

    except Exception:
        if db is not None:
            db.rollback()

        app.logger.exception("Failed to delete reminder")
        return jsonify({
            "success": False,
            "error": "Could not delete reminder"
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# LEARNING MODULE - GENERATE AND SAVE
# =========================

@app.route("/learning", methods=["POST"])
def generate_learning_content():
    data = request.get_json(silent=True) or {}

    topic = data.get("topic")
    mode = data.get("mode", "notes")
    level = data.get("level", "beginner")
    question_count = data.get("question_count", 5)

    if not isinstance(topic, str) or not topic.strip():
        return jsonify({
            "success": False,
            "error": "Please enter a topic to learn."
        }), 400

    topic = topic.strip()
    if len(topic) > 300:
        return jsonify({
            "success": False,
            "error": "Topic must be 300 characters or fewer."
        }), 400

    if mode not in ("notes", "explain", "quiz"):
        return jsonify({
            "success": False,
            "error": "Invalid learning mode."
        }), 400

    if level not in ("beginner", "intermediate", "exam"):
        return jsonify({
            "success": False,
            "error": "Invalid explanation level."
        }), 400

    try:
        question_count = int(question_count)
    except (TypeError, ValueError):
        return jsonify({
            "success": False,
            "error": "Invalid number of quiz questions."
        }), 400

    if question_count not in (5, 10, 15):
        return jsonify({
            "success": False,
            "error": "Choose 5, 10, or 15 questions."
        }), 400

    if level == "beginner":
        level_instruction = (
            "Explain from zero using simple language, define technical "
            "terms, and provide easy examples. Assume the learner is a beginner."
        )
    elif level == "intermediate":
        level_instruction = (
            "Give a college-level explanation with technical details, "
            "practical examples, and important concepts."
        )
    else:
        level_instruction = (
            "Focus on university exam preparation: definitions, key points, "
            "examples, relevant advantages and disadvantages, and exam questions."
        )

    if mode == "notes":
        task_instruction = """
        Create well-organized study notes with:
        1. A clear title
        2. Introduction and definition
        3. Main concepts with headings
        4. Examples where useful
        5. Relevant applications, advantages, or disadvantages
        6. A short revision summary
        7. Five important self-study questions
        Use Markdown headings, bullet points, and numbered lists.
        """
    elif mode == "explain":
        task_instruction = """
        Teach the topic like a patient personal tutor. Include:
        1. What the concept means
        2. Why it is important
        3. A step-by-step explanation
        4. Simple real-life and technical examples where appropriate
        5. Common mistakes or misunderstandings
        6. A short recap and three practice questions
        """
    else:
        task_instruction = f"""
        Create exactly {question_count} multiple-choice questions.
        Each question must have four options labelled A, B, C, and D.
        Put the correct answers and brief explanations in a separate answer
        key after all questions so the learner can attempt the quiz first.
        Include a mixture of basic and moderately challenging questions.
        """

    prompt = f"""
    You are SERA, a friendly and knowledgeable AI tutor inside Nexus AI.

    Topic: {topic}

    Learner level:
    {level_instruction}

    Learning task:
    {task_instruction}

    Rules:
    - Stay focused on the requested topic.
    - Be accurate and educational.
    - Explain abbreviations when first introduced.
    - Use Markdown formatting for readability.
    - If the topic is ambiguous, briefly state your interpretation.
    """

    db = None
    cursor = None

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt
        )
        generated_content = (response.text or "").strip()

        if not generated_content:
            return jsonify({
                "success": False,
                "error": "SERA could not generate content. Please try again."
            }), 502

        # Save the generated result only after Gemini returns content.
        db = get_connection()
        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO learning_history
                (user_id, topic, mode, level, content)
            VALUES (%s, %s, %s, %s, %s)
        """, (USER_ID, topic, mode, level, generated_content))

        history_id = cursor.lastrowid
        db.commit()

        return jsonify({
            "success": True,
            "history_id": history_id,
            "topic": topic,
            "mode": mode,
            "level": level,
            "content": generated_content
        }), 200

    except Exception:
        if db is not None:
            db.rollback()
        app.logger.exception("Learning generation or saving failed")
        return jsonify({
            "success": False,
            "error": (
                "SERA could not generate or save the content. "
                "Please try again."
            )
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# LEARNING MODULE - VIEW HISTORY
# =========================

@app.route("/learning/history", methods=["GET"])
def get_learning_history():
    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT history_id, topic, mode, level, content, created_at
            FROM learning_history
            WHERE user_id = %s
            ORDER BY created_at DESC, history_id DESC
        """, (USER_ID,))

        history = cursor.fetchall()
        for item in history:
            if item.get("created_at") is not None:
                item["created_at"] = item["created_at"].isoformat(sep=" ")

        return jsonify({
            "success": True,
            "history": history
        }), 200

    except Exception:
        app.logger.exception("Failed to fetch learning history")
        return jsonify({
            "success": False,
            "error": "Could not load learning history. Please try again."
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# SCHEDULE - GET ALL EVENTS
# =========================

@app.route("/schedule", methods=["GET"])
def get_schedule():
    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor(dictionary=True)

        cursor.execute("""
            SELECT schedule_id, title, description,
                   schedule_date, start_time, end_time
            FROM schedule
            WHERE user_id = %s
            ORDER BY schedule_date, start_time
        """, (USER_ID,))

        events = cursor.fetchall()

        for event in events:
            if event["schedule_date"]:
                event["schedule_date"] = event["schedule_date"].isoformat()
            if event["start_time"]:
                event["start_time"] = str(event["start_time"])
            if event["end_time"]:
                event["end_time"] = str(event["end_time"])

        return jsonify({"success": True, "events": events})

    except Exception:
        app.logger.exception("Failed to load schedule")
        return jsonify({
            "success": False,
            "error": "Could not load schedule."
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


# =========================
# SCHEDULE - ADD EVENT
# =========================

@app.route("/schedule", methods=["POST"])
def add_schedule_event():
    data = request.get_json(silent=True) or {}

    title = data.get("title")
    description = data.get("description") or None
    schedule_date = data.get("schedule_date")
    start_time = data.get("start_time")
    end_time = data.get("end_time") or None

    if not isinstance(title, str) or not title.strip():
        return jsonify({
            "success": False,
            "error": "Event title is required."
        }), 400

    if not isinstance(schedule_date, str) or not isinstance(start_time, str):
        return jsonify({
            "success": False,
            "error": "Date and start time are required."
        }), 400

    try:
        parsed_date = date.fromisoformat(schedule_date)
        parsed_start = time.fromisoformat(start_time)

        parsed_end = time.fromisoformat(end_time) if end_time else None

        if parsed_end and parsed_end <= parsed_start:
            return jsonify({
                "success": False,
                "error": "End time must be later than start time."
            }), 400

    except ValueError:
        return jsonify({
            "success": False,
            "error": "Enter a valid date and time."
        }), 400

    db = None
    cursor = None

    try:
        db = get_connection()
        cursor = db.cursor()

        cursor.execute("""
            INSERT INTO schedule
                (user_id, title, description, schedule_date,
                 start_time, end_time)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (
            USER_ID,
            title.strip(),
            description.strip() if isinstance(description, str) and description.strip() else None,
            parsed_date,
            parsed_start,
            parsed_end
        ))

        db.commit()

        return jsonify({
            "success": True,
            "message": "Schedule event added successfully.",
            "schedule_id": cursor.lastrowid
        }), 201

    except Exception:
        if db is not None:
            db.rollback()

        app.logger.exception("Failed to add schedule event")
        return jsonify({
            "success": False,
            "error": "Could not save schedule event."
        }), 500

    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()

# =========================
# RUN SERVER - MUST BE LAST
# =========================

if __name__ == "__main__":
    app.run(debug=True)