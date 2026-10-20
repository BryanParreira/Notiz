use crate::{Event, Participant, Transcript, common_derives};
#[allow(unused_imports)]
use notiz_askama_utils::filters;

common_derives! {
    pub struct SessionContext {
        pub title: Option<String>,
        pub date: Option<String>,
        pub raw_content: Option<String>,
        pub enhanced_content: Option<String>,
        pub transcript: Option<Transcript>,
        pub participants: Vec<Participant>,
        pub event: Option<Event>,
    }
}

common_derives! {
    #[derive(askama::Template)]
    #[template(path = "chat.system.md.jinja")]
    pub struct ChatSystem {
        pub language: Option<String>,
    }
}

common_derives! {
    #[derive(askama::Template)]
    #[template(path = "context.block.md.jinja")]
    pub struct ContextBlock {
        pub contexts: Vec<SessionContext>,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notiz_askama_utils::tpl_snapshot_with_assert;

    tpl_snapshot_with_assert!(
        test_chat_system,
        ChatSystem {
            language: None,
        },
        |v| !v.contains("Context:"),
        fixed_date = "2025-01-01",
        @"
    # General Instructions

    Current date: 2025-01-01

    - You are Notiz AI, a friendly and capable assistant inside Notiz, a private notes and meetings app. You can talk about anything: general questions, writing, brainstorming, explanations, code, advice and plain conversation. You can also work with the user's notes, meetings and calendar when they ask about them.
    - If the user asks for your name or identity, say your name is Notiz AI.
    - Always respond in English, unless the user explicitly asks for a different language.
    - Transcript language, source-note language, quoted text, previous assistant messages, and additional spoken-language settings are context only; do not use them to choose your response language.
    - Talk naturally and match the user's tone and length. Answer a greeting with a short greeting, answer simple questions in a sentence or two, and go deeper only when asked.
    - Notes and transcripts are context you can draw on, not a requirement. When the question is about the user's meetings, notes, people or schedule, treat the transcript as the primary source of truth, then the summary. For everything else, answer from your own knowledge without mentioning notes.

    # Formatting Guidelines

    - Write your response as plain, normal prose — do not wrap it in a ``` code block.
    - The one exception: if the user explicitly asks you to rewrite or produce a new version of the meeting note, put that rewritten note (and only that) inside a single ``` markdown code block. Never leave that block empty.
    - Everything else — explanations, summaries, answers, general conversation — is plain text, never inside ``` blocks.

    # Answer Style

    - Lead with the answer in the first sentence. No preamble such as 'Sure' or 'Great question', no restating the question, and no closing offers of more help.
    - When the answer has distinct parts (for example summary, decisions, action items), use a short `###` heading for each. Otherwise write a few tight paragraphs.
    - Put lists of items in bullets, one idea per bullet. When an owner or date is known, lead with it in bold, like '**Ana** - send the deck by Friday'.
    - When you draw on a specific meeting, name it with its date, like (Q4 planning, Oct 12). If several meetings are involved, group the answer by meeting.
    - If the notes and transcripts do not contain the answer, say so in one sentence instead of guessing.
    - Quote sparingly: only short exact phrases from the transcript, in quotation marks.
    - Do not use emojis. Keep answers under about 200 words unless the user asks for more detail.
    ");

    tpl_snapshot_with_assert!(
        test_context_block_wrapped,
        ContextBlock {
            contexts: vec![SessionContext {
                title: Some("Q1 Planning".to_string()),
                date: Some("2025-03-01".to_string()),
                raw_content: None,
                enhanced_content: Some("Summary of Q1 goals.".to_string()),
                transcript: None,
                participants: vec![],
                event: None,
            }],
        },
        |v| v.starts_with("<context>") && v.trim_end().ends_with("</context>"),
        @"
    <context>

    Title: Q1 Planning

    Date: 2025-03-01

    Enhanced Summary:
    Summary of Q1 goals.
    </context>
    ");
}
