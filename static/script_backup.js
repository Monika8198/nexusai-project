const messageInput = document.getElementById("messageInput");
const chatContainer = document.getElementById("chatContainer");
const sendButton = document.getElementById("sendButton");


// =========================
// Send Message
// =========================

async function sendMessage() {

    const message = messageInput.value.trim();

    // Don't send empty messages
    if (message === "") {
        return;
    }

    // Display user's message
    addMessage(message, "user");

    // Clear input
    messageInput.value = "";

    // Disable button while waiting
    sendButton.disabled = true;
    sendButton.textContent = "...";

    try {

        const response = await fetch("/chat", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                message: message
            })
        });


        const data = await response.json();


        // Display SERA response
        if (response.ok) {

            addMessage(data.response, "sera");

        } else {

            addMessage("Sorry, something went wrong.", "sera");

            console.error(data);
        }


    } catch (error) {

        console.error(error);

        addMessage(
            "I couldn't connect to the server.",
            "sera"
        );

    }


    // Enable button again
    sendButton.disabled = false;
    sendButton.textContent = "↑";
}


// =========================
// Add Message to Screen
// =========================

function addMessage(text, sender) {

    const messageDiv = document.createElement("div");

    messageDiv.classList.add("message", sender);

    const contentDiv = document.createElement("div");

    contentDiv.classList.add("message-content");

    if (typeof marked !== "undefined") {

        contentDiv.innerHTML = marked.parse(text);

    } else {

        contentDiv.textContent = text;

    }

    messageDiv.appendChild(contentDiv);

    chatContainer.appendChild(messageDiv);

    chatContainer.scrollTop = chatContainer.scrollHeight;
}


// =========================
// Enter Key
// =========================

function handleEnter(event) {

    if (event.key === "Enter" && !event.shiftKey) {

        event.preventDefault();

        sendMessage();
    }
}


// =========================
// New Chat
// =========================

function newChat() {

    chatContainer.innerHTML = `
        <div class="welcome">

            <div class="sera-symbol">✦</div>

            <h1>How can I help you?</h1>

            <p>
                I'm SERA, your intelligent AI companion.
                Ask me anything.
            </p>

        </div>
    `;

    messageInput.value = "";
    messageInput.focus();
}