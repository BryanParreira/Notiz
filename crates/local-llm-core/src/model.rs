use std::path::{Path, PathBuf};

#[cfg(target_arch = "aarch64")]
pub static SUPPORTED_MODELS: &[SupportedModel] = &[
    // Qwen2p5_3bQ4 excluded: its download URL 404s (GitHub release was
    // never published in this fork) and can never succeed as-is. Its enum
    // variant and match arms stay (see `supported_model_info` below) so
    // existing serialized settings referencing it still deserialize, but
    // it's not offered anywhere a user could pick it and get stuck.
    SupportedModel::Qwen3p5_9bQ4,
    SupportedModel::Qwen3p5_4bQ4,
    SupportedModel::Llama3p2_3bQ4,
    SupportedModel::NotizLLM,
    SupportedModel::Gemma3_4bQ4,
];

#[cfg(not(target_arch = "aarch64"))]
pub static SUPPORTED_MODELS: &[SupportedModel] = &[];

pub use notiz_local_model::GgufLlmModel as SupportedModel;

#[derive(serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ModelInfo {
    pub key: SupportedModel,
    pub name: String,
    pub description: String,
    pub size_bytes: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CustomModelInfo {
    pub path: String,
    pub name: String,
}

pub fn llm_models_dir(models_base: &Path) -> PathBuf {
    models_base.join("llm")
}

/// Total physical memory in bytes, when the OS reports it.
pub fn total_memory_bytes() -> Option<u64> {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let total = system.total_memory();
    (total > 0).then_some(total)
}

pub fn recommended_model() -> SupportedModel {
    SupportedModel::recommended_for_ram(total_memory_bytes())
}

pub fn list_supported_models() -> Vec<ModelInfo> {
    SUPPORTED_MODELS.iter().map(supported_model_info).collect()
}

pub fn supported_model_info(model: &SupportedModel) -> ModelInfo {
    let description = match model {
        // Download URL 404s (GitHub release never published in this fork)
        // — kept selectable so it starts working the moment that's fixed,
        // but not offered as the default in the meantime.
        SupportedModel::Qwen2p5_3bQ4 => "Currently unavailable — model download is broken.",
        SupportedModel::NotizLLM => "Experimental model trained by the Char team.",
        SupportedModel::Llama3p2_3bQ4 => "Lightweight fallback.",
        SupportedModel::Qwen3p5_4bQ4 => {
            "Best for 8 GB Macs. Smart for its size and light on memory."
        }
        SupportedModel::Qwen3p5_9bQ4 => {
            "Best for 16 GB Macs and up. Much stronger at following requests."
        }
        SupportedModel::Gemma3_4bQ4 => "Deprecated. Exists only for backward compatibility.",
    };

    ModelInfo {
        key: model.clone(),
        name: model.display_name().to_string(),
        description: description.to_string(),
        size_bytes: model.model_size(),
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ModelIdentifier {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "mock-onboarding")]
    MockOnboarding,
}
