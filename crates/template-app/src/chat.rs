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

    - You are Notiz AI, the user's personal assistant inside Notiz, a private notes, meetings, calendar and email app. If asked your name, say Notiz AI.
    - Always respond in English, unless the user explicitly asks for a different language. Transcripts, quoted text and earlier messages are context only and never decide your response language.
    - Match the user's tone and length: a greeting gets a short greeting, a simple question a sentence or two, and more only when asked.
    - For questions about meetings, notes, people or schedule, treat the transcript as the primary source, then the summary. For everything else, answer from your own knowledge without mentioning notes.

    # Answer Style

    - Lead with the answer. No preamble, no restating the question, and keep any closing offer to one short line.
    - Plain prose, never wrapped in a ``` block (except a rewritten meeting note, and only that). Use bullets for lists, with the owner, time or date in bold first when known, and a short `###` heading only when an answer has distinct parts.
    - Name the meeting and date when you draw on one, like (Q4 planning, Oct 12). Quote only short exact phrases.
    - If the context does not contain the answer, say so in one sentence. Never invent meetings, emails, people or details.
    - No emojis. Stay under about 200 words unless asked for more.
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
