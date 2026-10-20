#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("account not found")]
    AccountNotFound,
    #[error("could not sign in: {0}")]
    Login(String),
    #[error("mail server error: {0}")]
    Imap(String),
    #[error("secure storage error: {0}")]
    Keychain(String),
    #[error("the mail server did not respond in time")]
    Timeout,
    #[error("invalid input: {0}")]
    Invalid(&'static str),
}
