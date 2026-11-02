
/* =========================================
   SERA - FRONTEND JAVASCRIPT
   Chat, Tasks, Reminders, and AI Memory
   ========================================= */

const messageInput = document.getElementById("messageInput");
const chatContainer = document.getElementById("chatContainer");
const sendButton = document.getElementById("sendButton");

let seraToastTimer = null;
const notifiedReminderIds = new Set();

// =========================================
// CHAT
// =========================================

async function sendMessage() {
    if (!messageInput || !chatContainer || !sendButton) return;

    const message = messageInput.value.trim();
    if (!message || sendButton.disabled) return;

    const welcome = chatContainer.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    addMessage(message, "user");
    messageInput.value = "";
    autoResizeTextarea();

    sendButton.disabled = true;
    sendButton.textContent = "…";

    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Something went wrong.");
        }

        addMessage(data.response, "sera");
    } catch (error) {
        console.error("Chat error:", error);
        addMessage(
            "Sorry, I couldn't connect right now. Please try again.",
            "sera"
        );
    } finally {
        sendButton.disabled = false;
        sendButton.textContent = "↑";
        messageInput.focus();
    }
}

function addMessage(text, sender) {
    if (!chatContainer) return;

    const messageElement = document.createElement("div");
    messageElement.className = `chat-message ${sender}`;

    const wrapper = document.createElement("div");
    wrapper.className = "message-wrapper";

    const content = document.createElement("div");
    content.className = "message-content";

    if (sender === "user") {
        content.textContent = text;
    } else if (typeof marked !== "undefined") {
        content.innerHTML = marked.parse(text, {
            gfm: true,
            breaks: true
        });
    } else {
        content.textContent = text;
    }

    wrapper.appendChild(content);
    messageElement.appendChild(wrapper);
    chatContainer.appendChild(messageElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function handleEnter(event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function autoResizeTextarea() {
    if (!messageInput) return;

    messageInput.style.height = "auto";
    messageInput.style.height =
        Math.min(messageInput.scrollHeight, 140) + "px";
}

function newChat() {
    if (!chatContainer || !messageInput) return;

    chatContainer.innerHTML = `
        <div class="chat-welcome">
            <div class="welcome-mark">S</div>
            <div>
                <span class="eyebrow">PERSONAL AI COMPANION</span>
                <h2>Start a conversation</h2>
                <p>
                    Ask SERA anything, plan your day,
                    study, write, analyze or create.
                </p>
            </div>
        </div>
    `;

    messageInput.value = "";
    autoResizeTextarea();
    messageInput.focus();
}

if (messageInput) {
    messageInput.addEventListener("input", autoResizeTextarea);
}

if (sendButton) {
    sendButton.addEventListener("click", sendMessage);
}

// =========================================
// TASKS - LOAD
// =========================================

async function loadTasks() {
    const taskList = document.getElementById("taskList");
    if (!taskList) return;

    taskList.textContent = "Loading tasks...";

    try {
        const response = await fetch("/tasks");
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not load tasks.");
        }

        taskList.replaceChildren();

        if (!data.tasks || data.tasks.length === 0) {
            const empty = document.createElement("p");
            empty.className = "task-content";
            empty.textContent = "No tasks yet. Add your first task.";
            taskList.appendChild(empty);
            updateTaskCount(0);
            return;
        }

        data.tasks.forEach(task => {
            const card = document.createElement("div");
            card.className = "task-item";

            const mainRow = document.createElement("div");
            mainRow.className = "task-main";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = task.status === "completed";
            checkbox.setAttribute("aria-label", `Complete ${task.title}`);

            const title = document.createElement("span");
            title.className = "task-content";
            title.textContent = task.title;
            title.style.textDecoration =
                task.status === "completed" ? "line-through" : "none";

            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "task-edit";
            editButton.textContent = "Edit";
            editButton.title = "Edit task";
            editButton.addEventListener("click", () => showEditForm(task));

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "task-delete";
            deleteButton.textContent = "×";
            deleteButton.title = "Delete task";
            deleteButton.addEventListener("click", () => {
                deleteTask(task.task_id, task.title, deleteButton);
            });

            mainRow.append(checkbox, title, editButton, deleteButton);

            const details = document.createElement("div");
            details.className = "task-details";

            const priority = document.createElement("span");
            priority.className = "task-badge";

            const priorityValue = ["low", "medium", "high"].includes(
                String(task.priority || "").toLowerCase()
            )
                ? String(task.priority).toLowerCase()
                : "medium";

            priority.classList.add(`priority-${priorityValue}`);
            priority.textContent =
                priorityValue.charAt(0).toUpperCase() +
                priorityValue.slice(1);

            const dueDate = document.createElement("span");
            dueDate.className = "task-due-date";
            dueDate.textContent = formatDueDate(task.due_date);

            const status = document.createElement("span");
            status.className = "task-badge task-status";
            status.textContent =
                task.status === "completed" ? "Completed" : "Pending";

            details.append(priority, dueDate, status);
            card.append(mainRow, details);
            taskList.appendChild(card);

            checkbox.addEventListener("change", async () => {
                const previousStatus = task.status;
                checkbox.disabled = true;

                try {
                    await updateTaskStatus(
                        task.task_id,
                        checkbox,
                        title,
                        false
                    );

                    task.status = checkbox.checked ? "completed" : "pending";
                    updateTaskDetails(card, task);
                } catch (error) {
                    task.status = previousStatus;
                    checkbox.checked = previousStatus === "completed";
                } finally {
                    checkbox.disabled = false;
                }
            });
        });

        updateTaskCount(data.tasks.length);
    } catch (error) {
        console.error("Task loading error:", error);
        taskList.replaceChildren();

        const message = document.createElement("p");
        message.className = "task-content";
        message.textContent =
            "Unable to load tasks. Please refresh the page.";

        taskList.appendChild(message);
    }
}

function formatDueDate(value) {
    if (!value) return "No due date";

    const parts = String(value).split("-");
    if (parts.length !== 3) return `Due: ${value}`;

    return `Due: ${parts[2]}-${parts[1]}-${parts[0]}`;
}

function updateTaskDetails(card, task) {
    const details = card.querySelector(".task-details");
    if (!details) return;

    const status = details.querySelector(".task-status");

    if (status) {
        status.textContent =
            task.status === "completed" ? "Completed" : "Pending";
    }

    const title = card.querySelector(".task-content");

    if (title) {
        title.style.textDecoration =
            task.status === "completed" ? "line-through" : "none";
    }
}

// =========================================
// TASKS - EDIT
// =========================================

function showEditForm(task) {
    const existing = document.getElementById("taskEditForm");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "taskEditForm";
    overlay.className = "task-edit-overlay";

    const form = document.createElement("form");
    form.className = "task-edit-modal";

    const heading = document.createElement("h3");
    heading.textContent = "Edit Task";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.name = "title";
    titleInput.required = true;
    titleInput.maxLength = 255;
    titleInput.value = task.title;

    const titleLabel = document.createElement("label");
    titleLabel.textContent = "Task title";
    titleLabel.appendChild(titleInput);

    const descriptionInput = document.createElement("textarea");
    descriptionInput.name = "description";
    descriptionInput.rows = 3;
    descriptionInput.value = task.description || "";

    const descriptionLabel = document.createElement("label");
    descriptionLabel.textContent = "Description";
    descriptionLabel.appendChild(descriptionInput);

    const prioritySelect = document.createElement("select");
    prioritySelect.name = "priority";

    ["low", "medium", "high"].forEach(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent =
            value.charAt(0).toUpperCase() + value.slice(1);
        prioritySelect.appendChild(option);
    });

    prioritySelect.value = task.priority || "medium";

    const priorityLabel = document.createElement("label");
    priorityLabel.textContent = "Priority";
    priorityLabel.appendChild(prioritySelect);

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.name = "due_date";
    dateInput.value = task.due_date || "";

    const dateLabel = document.createElement("label");
    dateLabel.textContent = "Due date";
    dateLabel.appendChild(dateInput);

    const actions = document.createElement("div");
    actions.className = "task-edit-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "task-edit-cancel";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => overlay.remove());

    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "task-edit-save";
    saveButton.textContent = "Save Changes";

    actions.append(cancelButton, saveButton);

    form.append(
        heading,
        titleLabel,
        descriptionLabel,
        priorityLabel,
        dateLabel,
        actions
    );

    overlay.appendChild(form);
    document.body.appendChild(overlay);
    titleInput.focus();

    overlay.addEventListener("click", event => {
        if (event.target === overlay) overlay.remove();
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const updatedTask = {
            title: titleInput.value.trim(),
            description: descriptionInput.value.trim(),
            priority: prioritySelect.value,
            due_date: dateInput.value || null
        };

        if (!updatedTask.title) {
            showToast("Task title is required.");
            titleInput.focus();
            return;
        }

        saveButton.disabled = true;
        saveButton.textContent = "Saving...";

        try {
            const response = await fetch(`/tasks/${task.task_id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updatedTask)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Could not edit task.");
            }

            overlay.remove();
            await loadTasks();
            showToast("Task updated successfully!");
        } catch (error) {
            console.error("Edit task error:", error);
            showToast(error.message || "Could not edit task.");

            saveButton.disabled = false;
            saveButton.textContent = "Save Changes";
        }
    });
}

// =========================================
// TASKS - UPDATE STATUS
// =========================================

async function updateTaskStatus(
    taskId,
    checkbox,
    title,
    displayToast = true
) {
    const newStatus = checkbox.checked ? "completed" : "pending";

    try {
        const response = await fetch(`/tasks/${taskId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not update task.");
        }

        title.style.textDecoration =
            newStatus === "completed" ? "line-through" : "none";

        if (displayToast) {
            showToast(
                newStatus === "completed"
                    ? "Task marked as completed!"
                    : "Task marked as pending."
            );
        }
    } catch (error) {
        checkbox.checked = !checkbox.checked;
        title.style.textDecoration =
            checkbox.checked ? "line-through" : "none";

        showToast(error.message || "Could not update task.");
        throw error;
    }
}

// =========================================
// TASKS - DELETE
// =========================================

async function deleteTask(taskId, taskTitle, deleteButton) {
    if (!confirm(
        `Are you sure you want to delete "${taskTitle}"?\n\nThis action cannot be undone.`
    )) return;

    deleteButton.disabled = true;

    try {
        const response = await fetch(`/tasks/${taskId}`, {
            method: "DELETE"
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not delete task.");
        }

        await loadTasks();
        showToast("Task deleted successfully!");
    } catch (error) {
        console.error("Delete task error:", error);
        deleteButton.disabled = false;
        showToast(error.message || "Could not delete task.");
    }
}

// =========================================
// TASKS - UPDATE COUNT
// =========================================

function updateTaskCount(count) {
    const value = document.getElementById("taskCount");

    if (value) {
        value.textContent = String(count).padStart(2, "0");
    }
}

// =========================================
// TASKS - ADD
// =========================================

async function addTask() {
    const title = prompt("Enter your task title:");
    if (title === null || !title.trim()) return;

    const description =
        prompt("Enter task description (optional):") || "";

    const priorityInput = prompt(
        "Enter priority: low, medium, or high",
        "medium"
    );

    if (priorityInput === null) return;

    const priority = priorityInput.trim().toLowerCase();

    if (!["low", "medium", "high"].includes(priority)) {
        showToast("Priority must be low, medium, or high.");
        return;
    }

    const dueDate = prompt(
        "Enter due date as DD-MM-YYYY (e.g., 12-10-2026), or leave blank:"
    );

    if (dueDate === null) return;

    const cleanDate = dueDate.trim();
    let formattedDate = null;

    if (cleanDate) {
        if (!/^\d{2}-\d{2}-\d{4}$/.test(cleanDate)) {
            showToast("Please enter the date as DD-MM-YYYY.");
            return;
        }

        const [day, month, year] = cleanDate.split("-").map(Number);
        const parsedDate = new Date(year, month - 1, day);

        if (
            parsedDate.getFullYear() !== year ||
            parsedDate.getMonth() !== month - 1 ||
            parsedDate.getDate() !== day
        ) {
            showToast("Please enter a valid calendar date.");
            return;
        }

        formattedDate =
            `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    try {
        const response = await fetch("/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: title.trim(),
                description: description.trim(),
                priority,
                due_date: formattedDate
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not create task.");
        }

        await loadTasks();
        showToast("Task added successfully!");
    } catch (error) {
        console.error("Add task error:", error);
        showToast(error.message || "Could not add task.");
    }
}

// =========================================
// REMINDERS - ALERT CHECKING
// =========================================

function checkDueReminders(reminders) {
    const now = new Date();

    reminders.forEach(reminder => {
        const dateValue = String(reminder.reminder_date).slice(0, 10);
        const timeValue = String(reminder.reminder_time).slice(0, 8);
        const reminderDateTime = new Date(`${dateValue}T${timeValue}`);
        const reminderId = String(reminder.reminder_id);

        if (
            !Number.isNaN(reminderDateTime.getTime()) &&
            reminderDateTime <= now &&
            !notifiedReminderIds.has(reminderId)
        ) {
            notifiedReminderIds.add(reminderId);
            showToast(`🚨 REMINDER DUE!\n${reminder.title}`, "reminder");
        }
    });
}

// =========================================
// REMINDERS - LOAD
// =========================================

async function loadReminders() {
    const container = document.getElementById("reminders-list");
    if (!container) return;

    try {
        const response = await fetch("/reminders");
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Could not load reminders.");
        }

        const reminders = Array.isArray(data.reminders)
            ? data.reminders
            : [];

        container.replaceChildren();

        if (reminders.length === 0) {
            container.textContent = "No reminders yet.";
            updateReminderCount(0);
            return;
        }

        reminders.forEach(reminder => {
            const item = document.createElement("div");
            item.className = "reminder-item";

            const details = document.createElement("div");
            details.className = "reminder-details";

            const title = document.createElement("strong");
            title.textContent = reminder.title;

            const dateTime = document.createElement("p");
            dateTime.textContent =
                `${reminder.reminder_date} at ${reminder.reminder_time}`;

            details.append(title, dateTime);

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.textContent = "Delete";
            deleteButton.addEventListener("click", () => {
                deleteReminder(reminder.reminder_id);
            });

            item.append(details, deleteButton);
            container.appendChild(item);
        });

        updateReminderCount(reminders.length);
        checkDueReminders(reminders);
    } catch (error) {
        console.error("Reminder loading error:", error);
        container.textContent = "Unable to load reminders.";
    }
}

function updateReminderCount(count) {
    const value = document.getElementById("reminderCount");
    if (value) value.textContent = String(count).padStart(2, "0");
}

// =========================================
// REMINDERS - ADD
// =========================================

async function addReminder() {
    const title = prompt("What should SERA remind you about?");
    if (title === null || !title.trim()) return;

    const reminderDate = prompt("Enter date (YYYY-MM-DD):");
    if (!reminderDate) return;

    const reminderTime = prompt("Enter time (HH:MM, 24-hour format)");
    if (!reminderTime) return;

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(reminderDate) ||
        !/^\d{2}:\d{2}$/.test(reminderTime)
    ) {
        alert("Enter date as YYYY-MM-DD and time as HH:MM.");
        return;
    }

    const [year, month, day] = reminderDate.split("-").map(Number);
    const parsedDate = new Date(year, month - 1, day);
    const [hour, minute] = reminderTime.split(":").map(Number);

    if (
        parsedDate.getFullYear() !== year ||
        parsedDate.getMonth() !== month - 1 ||
        parsedDate.getDate() !== day ||
        hour > 23 ||
        minute > 59
    ) {
        alert("Please enter a valid date and time.");
        return;
    }

    try {
        const response = await fetch("/reminders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: title.trim(),
                reminder_date: reminderDate,
                reminder_time: reminderTime
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Could not save reminder.");
        }

        showToast("Reminder saved successfully!");
        await loadReminders();
    } catch (error) {
        console.error("Add reminder error:", error);
        showToast(error.message || "Unable to save reminder.");
    }
}

// =========================================
// REMINDERS - DELETE
// =========================================

async function deleteReminder(reminderId) {
    if (!confirm("Delete this reminder?")) return;

    try {
        const response = await fetch(`/reminders/${reminderId}`, {
            method: "DELETE"
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Could not delete reminder.");
        }

        await loadReminders();
        showToast("Reminder deleted successfully!");
    } catch (error) {
        console.error("Delete reminder error:", error);
        showToast(error.message || "Unable to delete reminder.");
    }
}

// =========================================
// AI MEMORY - LOAD AND DISPLAY
// =========================================

async function loadMemories() {
    const memoryList = document.getElementById("memoryList");
    if (!memoryList) return;

    memoryList.textContent = "Loading memories...";

    try {
        const response = await fetch("/memory");
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not load memories.");
        }

        // Support either {memories: [...]} or {memory: [...]} responses.
        const memories = Array.isArray(data.memories)
            ? data.memories
            : Array.isArray(data.memory)
                ? data.memory
                : [];

        memoryList.replaceChildren();
        updateMemoryCount(memories.length);

        if (memories.length === 0) {
            const empty = document.createElement("div");
            empty.className = "memory-empty";
            empty.textContent =
                "No memories saved yet. Add one below, or tell SERA something useful to remember.";
            memoryList.appendChild(empty);
            return;
        }

        memories.forEach(memory => {
            const id = memory.memory_id ?? memory.id;
            const memoryText =
                memory.memory_text ?? memory.text ?? "";

            const item = document.createElement("article");
            item.className = "memory-item";

            Object.assign(item.style, {
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "20px",
                padding: "20px",
                margin: "12px 0",
                border: "1px solid #343449",
                borderRadius: "12px",
                background: "#171725"
            });

            const content = document.createElement("div");
            content.className = "memory-content";

            Object.assign(content.style, {
                flex: "1",
                minWidth: "0",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontSize: "15px",
                lineHeight: "1.7",
                color: "#e5e5ef"
            });

            content.textContent = memoryText;

            if (memory.created_at) {
                const created = document.createElement("small");
                created.textContent = `Saved: ${String(memory.created_at).slice(0, 19)}`;
                created.style.display = "block";
                created.style.marginTop = "10px";
                created.style.color = "#9999ad";
                content.appendChild(created);
            }

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.textContent = "Delete";
            deleteButton.setAttribute("aria-label", "Delete this memory");

            Object.assign(deleteButton.style, {
                flexShrink: "0",
                padding: "9px 14px",
                border: "1px solid #8b343d",
                borderRadius: "8px",
                background: "#381c25",
                color: "#ffb8bd",
                cursor: "pointer"
            });

            deleteButton.addEventListener("click", () => {
                if (id !== undefined && id !== null) {
                    deleteMemory(id, deleteButton);
                } else {
                    showToast("This memory has no ID and cannot be deleted.");
                }
            });

            item.append(content, deleteButton);
            memoryList.appendChild(item);
        });
    } catch (error) {
        console.error("Memory loading error:", error);
        memoryList.textContent =
            "Unable to load memories. Check the Flask server and /memory route.";
    }
}

function updateMemoryCount(count) {
    const value = document.getElementById("memoryCount");
    if (value) value.textContent = String(count).padStart(2, "0");
}

// =========================================
// AI MEMORY - ADD
// =========================================

async function addMemory() {
    const input = document.getElementById("memoryInput");
    if (!input) return;

    const memoryText = input.value.trim();

    if (!memoryText) {
        showToast("Write something to save as a memory.");
        input.focus();
        return;
    }

    if (memoryText.length > 2000) {
        showToast("Memory must be 2000 characters or fewer.");
        return;
    }

    try {
        const response = await fetch("/memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ memory_text: memoryText })
        });

        const data = await response.json();

        if (!response.ok || data.success === false) {
            throw new Error(data.error || "Could not save memory.");
        }

        input.value = "";
        await loadMemories();
        showToast("Memory saved successfully!");
    } catch (error) {
        console.error("Add memory error:", error);
        showToast(error.message || "Unable to save memory.");
    }
}

// =========================================
// AI MEMORY - DELETE
// =========================================

async function deleteMemory(memoryId, button) {
    if (!confirm("Delete this saved memory? SERA may no longer use it in future chats.")) {
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent = "Deleting...";
    }

    try {
        const response = await fetch(`/memory/${memoryId}`, {
            method: "DELETE"
        });

        const data = await response.json();

        if (!response.ok || data.success === false) {
            throw new Error(data.error || "Could not delete memory.");
        }

        await loadMemories();
        showToast("Memory deleted successfully!");
    } catch (error) {
        console.error("Delete memory error:", error);
        showToast(error.message || "Unable to delete memory.");

        if (button) {
            button.disabled = false;
            button.textContent = "Delete";
        }
    }
}

// =========================================
// MODULE NAVIGATION
// =========================================

function closeMemoryWorkspace() {
    const memoryModule = document.getElementById("memoryModule");
    if (!memoryModule) return;

    memoryModule.style.position = "";
    memoryModule.style.inset = "";
    memoryModule.style.zIndex = "";
    memoryModule.style.width = "";
    memoryModule.style.maxHeight = "";
    memoryModule.style.overflowY = "";
    memoryModule.style.padding = "";
    memoryModule.style.margin = "";
    memoryModule.style.background = "";
    memoryModule.style.border = "";
    memoryModule.style.borderRadius = "";
    memoryModule.style.boxShadow = "";
    memoryModule.style.color = "";

    const closeButton = document.getElementById("closeMemoryWorkspace");
    if (closeButton) closeButton.remove();

    document.body.style.overflow = "";
}

function openModule(moduleName) {
    const moduleCards = document.querySelectorAll(".module-card");

    moduleCards.forEach(card => card.classList.remove("active"));

    const clickedCard = Array.from(moduleCards).find(card =>
        card.getAttribute("onclick")?.includes(`'${moduleName}'`)
    );

    if (clickedCard) clickedCard.classList.add("active");

    if (moduleName !== "memory") {
        closeMemoryWorkspace();
    }

    if (moduleName === "chat") {
        if (messageInput) messageInput.focus();
        return;
    }

    if (moduleName === "tasks") {
        loadTasks();
        showToast("Tasks refreshed from the database.");
        return;
    }

    if (moduleName === "reminders") {
        loadReminders();
        showToast("Reminders refreshed from the database.");
        return;
    }
if (moduleName === "schedule") {
    openScheduleWorkspace();
    return;
}
    if (moduleName === "memory") {
        openMemoryWorkspace();
        loadMemories();
        return;
    }

    const moduleNames = {
    schedule: "SCHEDULE",
    learning: "LEARNING"
    };

    showToast(
        `${moduleNames[moduleName] || "MODULE"} module integration is coming next.`
    );
}


async function loadTodaySchedule() {
    const list = document.getElementById("todayScheduleList");
    const dateLabel = document.getElementById("todayDate");

    if (!list) return;

    const today = new Date();
    const todayString = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0")
    ].join("-");

    if (dateLabel) {
        dateLabel.textContent = today.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short"
        }).toUpperCase();
    }

    try {
        const response = await fetch("/schedule");
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error("Could not load schedule");
        }

        const events = result.events.filter(
            event => event.schedule_date === todayString
        );

        if (events.length === 0) {
            list.innerHTML = '<p class="schedule-empty">No events planned for today.</p>';
            return;
        }

        list.innerHTML = events.map(event => {
            const timeText = event.start_time.slice(0, 5);
            const safeTitle = String(event.title).replace(/[&<>"']/g, char => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            })[char]);

            return `
                <div class="schedule-item">
                    <span class="schedule-time">${timeText}</span>
                    <span class="schedule-event">${safeTitle}</span>
                </div>
            `;
        }).join("");
    } catch (error) {
        console.error("Today's schedule failed to load:", error);
        list.innerHTML = '<p class="schedule-empty">Could not load schedule. Please refresh.</p>';
    }
}

const refreshTodayScheduleButton =
    document.getElementById("refreshTodaySchedule");

if (refreshTodayScheduleButton) {
    refreshTodayScheduleButton.addEventListener("click", loadTodaySchedule);
}

loadTodaySchedule();


// Make Memory a large, dedicated workspace without changing the HTML layout.
function openMemoryWorkspace() {
    const memoryModule = document.getElementById("memoryModule");
    if (!memoryModule) {
        showToast("Memory workspace was not found in index.html.");
        return;
    }

    Object.assign(memoryModule.style, {
        position: "fixed",
        inset: "24px",
        zIndex: "9990",
        width: "auto",
        maxHeight: "calc(100vh - 48px)",
        overflowY: "auto",
        padding: "clamp(22px, 4vw, 48px)",
        margin: "0",
        background: "#11111d",
        border: "1px solid #39394e",
        borderRadius: "18px",
        boxShadow: "0 20px 90px rgba(0,0,0,0.75)",
        color: "#f4f2ff"
    });

    document.body.style.overflow = "hidden";

    const heading = memoryModule.querySelector(".panel-header");

    if (heading && !document.getElementById("closeMemoryWorkspace")) {
        const closeButton = document.createElement("button");
        closeButton.id = "closeMemoryWorkspace";
        closeButton.type = "button";
        closeButton.textContent = "✕ Close";
        closeButton.setAttribute("aria-label", "Close memory workspace");

        Object.assign(closeButton.style, {
            padding: "10px 16px",
            border: "1px solid #44445a",
            borderRadius: "8px",
            background: "#222234",
            color: "#f4f2ff",
            cursor: "pointer"
        });

        closeButton.addEventListener("click", () => {
            closeMemoryWorkspace();
        });

        heading.appendChild(closeButton);
    }

    const input = document.getElementById("memoryInput");

    if (input) {
        Object.assign(input.style, {
            display: "block",
            boxSizing: "border-box",
            width: "100%",
            minHeight: "120px",
            padding: "16px",
            marginTop: "12px",
            border: "1px solid #45455e",
            borderRadius: "10px",
            background: "#191927",
            color: "#ffffff",
            fontSize: "16px",
            lineHeight: "1.6",
            resize: "vertical"
        });
    }

    const addButton = memoryModule.querySelector(
        'button[onclick="addMemory()"]'
    );

    if (addButton) {
        Object.assign(addButton.style, {
            padding: "12px 20px",
            marginTop: "12px",
            border: "none",
            borderRadius: "9px",
            background: "#b9a5e8",
            color: "#171322",
            fontSize: "15px",
            fontWeight: "700",
            cursor: "pointer"
        });
    }

    memoryModule.scrollTop = 0;
}

// =========================================
// TOAST NOTIFICATIONS
// =========================================

function showToast(message, type = "normal") {
    let toast = document.getElementById("seraToast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "seraToast";
        document.body.appendChild(toast);
    }

    if (seraToastTimer) {
        clearTimeout(seraToastTimer);
    }

    Object.assign(toast.style, {
        position: "fixed",
        top: type === "reminder" ? "24px" : "auto",
        right: type === "reminder" ? "24px" : "auto",
        bottom: type === "reminder" ? "auto" : "28px",
        left: type === "reminder" ? "auto" : "50%",
        transform: type === "reminder"
            ? "translateY(0)"
            : "translateX(-50%)",
        width: type === "reminder"
            ? "min(440px, calc(100vw - 32px))"
            : "auto",
        maxWidth: "calc(100vw - 32px)",
        padding: type === "reminder" ? "24px" : "12px 18px",
        background: type === "reminder" ? "#dc2626" : "#171717",
        color: "#ffffff",
        border: type === "reminder"
            ? "2px solid #ff8585"
            : "1px solid #444444",
        borderLeft: type === "reminder"
            ? "8px solid #991b1b"
            : "1px solid #444444",
        borderRadius: type === "reminder" ? "14px" : "8px",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: type === "reminder" ? "20px" : "12px",
        fontWeight: type === "reminder" ? "800" : "500",
        lineHeight: "1.5",
        whiteSpace: "pre-line",
        overflowWrap: "anywhere",
        boxShadow: type === "reminder"
            ? "0 12px 40px rgba(220, 38, 38, 0.55)"
            : "0 5px 20px rgba(0, 0, 0, 0.35)",
        zIndex: "99999",
        display: "block",
        opacity: "1",
        visibility: "visible",
        pointerEvents: "none"
    });

    toast.textContent = message;

    seraToastTimer = setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.visibility = "hidden";

        setTimeout(() => {
            if (toast.isConnected) {
                toast.style.display = "none";
            }
        }, 300);
    }, type === "reminder" ? 10000 : 4000);

    toast.style.display = "block";
}

// =========================================
// INITIALIZE
// =========================================

if (messageInput) {
    messageInput.focus();
}

loadTasks();
loadReminders();
loadMemories();

// Check saved reminders every 15 seconds while SERA is open.
setInterval(loadReminders, 15000);

/* =========================================
   SERA LEARNING MODULE
   ========================================= */

function openLearningWorkspace() {
    const learningModule = document.getElementById("learningModule");

    if (!learningModule) {
        showToast("Learning workspace not found. Check index.html.");
        return;
    }

    // Close the memory workspace if it is open.
    closeMemoryWorkspace();

    // Open the learning workspace.
    Object.assign(learningModule.style, {
        display: "block",
        position: "fixed",
        inset: "24px",
        zIndex: "9990",
        width: "auto",
        maxHeight: "calc(100vh - 48px)",
        overflowY: "auto",
        boxSizing: "border-box",
        padding: "clamp(22px, 4vw, 48px)",
        margin: "0",
        background: "#11111d",
        border: "1px solid #39394e",
        borderRadius: "18px",
        boxShadow: "0 20px 90px rgba(0,0,0,0.75)",
        color: "#f4f2ff"
    });

    document.body.style.overflow = "hidden";

    const topicInput = document.getElementById("learningTopic");
    if (topicInput) topicInput.focus();

    const modeSelect = document.getElementById("learningMode");
    if (modeSelect) updateQuizOptions(modeSelect.value);
}

function closeLearningWorkspace() {
    const learningModule = document.getElementById("learningModule");
    if (!learningModule) return;

    learningModule.style.display = "none";

    [
        "position", "inset", "zIndex", "width", "maxHeight",
        "overflowY", "boxSizing", "padding", "margin",
        "background", "border", "borderRadius", "boxShadow", "color"
    ].forEach(property => {
        learningModule.style[property] = "";
    });

    document.body.style.overflow = "";
}

function updateQuizOptions(mode) {
    const quizOptions = document.getElementById("quizOptions");

    if (quizOptions) {
        quizOptions.style.display = mode === "quiz" ? "block" : "none";
    }
}

// Show or hide quiz settings when the learning mode changes.
const learningModeSelect = document.getElementById("learningMode");

if (learningModeSelect) {
    learningModeSelect.addEventListener("change", function () {
        updateQuizOptions(this.value);
    });
}

async function generateLearningContent() {
    const topicInput = document.getElementById("learningTopic");
    const modeSelect = document.getElementById("learningMode");
    const levelSelect = document.getElementById("learningLevel");
    const questionCountSelect = document.getElementById("quizQuestionCount");
    const output = document.getElementById("learningOutput");
    const status = document.getElementById("learningStatus");
    const button = document.getElementById("generateLearningButton");

    if (!topicInput || !modeSelect || !levelSelect || !output || !button) {
        showToast("Some Learning Module elements are missing from index.html.");
        return;
    }

    const topic = topicInput.value.trim();
    const mode = modeSelect.value;
    const level = levelSelect.value;
    const questionCount = questionCountSelect
        ? Number(questionCountSelect.value)
        : 5;

    if (!topic) {
        showToast("Please enter a topic to learn.");
        topicInput.focus();
        return;
    }

    if (topic.length > 300) {
        showToast("Please keep the topic under 300 characters.");
        return;
    }

    button.disabled = true;
    button.textContent = "Generating...";
    if (status) status.textContent = "SERA is preparing your learning content...";

    output.replaceChildren();

    const loadingMessage = document.createElement("p");
    loadingMessage.textContent = "Please wait while SERA generates your content.";
    output.appendChild(loadingMessage);

    try {
        const response = await fetch("/learning", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                topic: topic,
                mode: mode,
                level: level,
                question_count: questionCount
            })
        });

        const data = await response.json();

        if (!response.ok || data.success === false) {
            throw new Error(data.error || "Could not generate learning content.");
        }

        const content = data.content || data.response;

        if (!content || typeof content !== "string") {
            throw new Error("SERA returned an empty response. Please try again.");
        }

        output.replaceChildren();

        const resultHeading = document.createElement("h3");
        resultHeading.textContent =
            (mode === "notes" ? "Study Notes: " :
             mode === "explain" ? "Concept Explanation: " :
             "Practice Quiz: ") + topic;

        const resultContent = document.createElement("div");
        resultContent.className = "learning-result-content";

        // Render Markdown when the existing Markdown library is available.
        // Otherwise, show the response as plain text.
        if (typeof marked !== "undefined") {
            resultContent.innerHTML = marked.parse(content, {
                gfm: true,
                breaks: true
            });
        } else {
            resultContent.textContent = content;
        }

        output.append(resultHeading, resultContent);

        if (status) status.textContent = "Content generated successfully.";

    } catch (error) {
        console.error("Learning module error:", error);

        output.replaceChildren();

        const errorMessage = document.createElement("p");
        errorMessage.textContent = error.message ||
            "Unable to generate content. Please try again.";

        output.appendChild(errorMessage);

        if (status) status.textContent = "Generation failed.";
    } finally {
        button.disabled = false;
        button.textContent = "✦ Generate with SERA";
    }
}

async function loadLearningHistory() {
    const historyList = document.getElementById("learningHistoryList");

    if (!historyList) {
        console.warn("Learning history element was not found.");
        return;
    }

    historyList.innerHTML = "<p>Loading saved sessions...</p>";

    try {
        const response = await fetch("/learning/history");
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Could not load learning history.");
        }

        if (!Array.isArray(data.history) || data.history.length === 0) {
            historyList.innerHTML =
                "<p class='welcome-text'>No saved learning sessions yet.</p>";
            return;
        }

        historyList.innerHTML = "";

        data.history.forEach((item) => {
            const card = document.createElement("div");
            card.className = "learning-history-item";

            const title = document.createElement("h4");
            title.textContent = item.topic || "Untitled session";

            const details = document.createElement("p");
            details.className = "welcome-text";
            details.textContent =
                `${item.mode || "Study"} · ${item.level || "Beginner"} · ${item.created_at || ""}`;

            const openButton = document.createElement("button");
            openButton.type = "button";
            openButton.className = "small-action";
            openButton.textContent = "View notes";

            openButton.addEventListener("click", () => {
                const output = document.getElementById("learningOutput");

                if (output) {
                    output.textContent = "";

                    const heading = document.createElement("h3");
                    heading.textContent = item.topic || "Saved session";

                    const content = document.createElement("div");
                    content.className = "learning-saved-content";

                    // Render saved content as plain text safely.
                    content.textContent = item.content || "No content saved.";

                    output.appendChild(heading);
                    output.appendChild(content);
                    output.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });
                }
            });

            card.appendChild(title);
            card.appendChild(details);
            card.appendChild(openButton);
            historyList.appendChild(card);
        });

    } catch (error) {
        console.error("Learning history error:", error);
        historyList.innerHTML =
            "<p class='welcome-text'>Could not load history. Please try Refresh.</p>";
    }
}

/* =========================
   SCHEDULE WORKSPACE
========================= */

function openScheduleWorkspace() {
    const workspace = document.getElementById("scheduleModule");
    if (!workspace) return;

    // Close other workspaces without changing their existing functions.
    const learning = document.getElementById("learningModule");
    const memory = document.getElementById("memoryModule");

    if (learning) learning.style.display = "none";
    if (memory) memory.style.display = "none";

    workspace.style.display = "block";

    const dateInput = document.getElementById("scheduleDate");
    if (dateInput && !dateInput.value) {
        const now = new Date();
        dateInput.value = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0")
        ].join("-");
    }

    loadScheduleEvents();
    workspace.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeScheduleWorkspace() {
    const workspace = document.getElementById("scheduleModule");
    if (workspace) workspace.style.display = "none";

    document.querySelectorAll(".module-card").forEach(card => {
        card.classList.remove("active");
    });
}

async function loadScheduleEvents() {
    const list = document.getElementById("scheduleEventsList");
    if (!list) return;

    list.innerHTML = '<p class="welcome-text">Loading events...</p>';

    try {
        const response = await fetch("/schedule");
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || "Could not load events.");
        }

        if (!result.events.length) {
            list.innerHTML = '<p class="welcome-text">No events saved yet. Add your first event above.</p>';
            return;
        }

        list.innerHTML = result.events.map(event => {
            const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            })[char]);

            const start = event.start_time
                ? event.start_time.slice(0, 5)
                : "";
            const end = event.end_time
                ? ` – ${event.end_time.slice(0, 5)}`
                : "";

            return `
                <div class="schedule-item">
                    <span class="schedule-time">
                        ${escapeHTML(event.schedule_date)}<br>
                        ${escapeHTML(start + end)}
                    </span>
                    <span class="schedule-event">
                        <strong>${escapeHTML(event.title)}</strong>
                        ${event.description
                            ? `<br><small>${escapeHTML(event.description)}</small>`
                            : ""}
                    </span>
                </div>
            `;
        }).join("");
    } catch (error) {
        console.error("Schedule loading failed:", error);
        list.innerHTML = '<p class="welcome-text">Could not load events. Please try again.</p>';
    }
}

async function addScheduleEvent() {
    const titleInput = document.getElementById("scheduleTitle");
    const descriptionInput = document.getElementById("scheduleDescription");
    const dateInput = document.getElementById("scheduleDate");
    const startInput = document.getElementById("scheduleStartTime");
    const endInput = document.getElementById("scheduleEndTime");
    const status = document.getElementById("scheduleStatus");
    const saveButton = document.getElementById("saveScheduleButton");

    const title = titleInput.value.trim();
    const scheduleDate = dateInput.value;
    const startTime = startInput.value;
    const endTime = endInput.value;

    if (!title || !scheduleDate || !startTime) {
        status.textContent = "Please enter an event title, date, and start time.";
        return;
    }

    if (endTime && endTime <= startTime) {
        status.textContent = "End time must be later than start time.";
        return;
    }

    status.textContent = "Saving event...";
    saveButton.disabled = true;

    try {
        const response = await fetch("/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title,
                description: descriptionInput.value.trim(),
                schedule_date: scheduleDate,
                start_time: startTime,
                end_time: endTime
            })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || "Could not save event.");
        }

        status.textContent = "Event saved successfully!";
        titleInput.value = "";
        descriptionInput.value = "";
        startInput.value = "";
        endInput.value = "";

        await loadScheduleEvents();
        await loadTodaySchedule();
    } catch (error) {
        console.error("Schedule saving failed:", error);
        status.textContent = error.message || "Could not save event. Please try again.";
    } finally {
        saveButton.disabled = false;
    }
}
