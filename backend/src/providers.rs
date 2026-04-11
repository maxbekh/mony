use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("API request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("provider returned an error: {0}")]
    Api(String),
    #[error("provider not configured")]
    NotConfigured,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SuggestionRequest {
    pub description: String,
    pub existing_category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SuggestionResponse {
    pub category_key: String,
    pub confidence: f32,
    pub reasoning: String,
}

#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn suggest_category(&self, request: SuggestionRequest) -> Result<SuggestionResponse, ProviderError>;
}

pub struct GeminiProvider {
    api_key: Option<String>,
    token: Option<String>,
    client: reqwest::Client,
}

impl GeminiProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key: Some(api_key),
            token: None,
            client: reqwest::Client::new(),
        }
    }

    pub fn new_with_token(token: String) -> Self {
        Self {
            api_key: None,
            token: Some(token),
            client: reqwest::Client::new(),
        }
    }
}

#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiContentResponse,
}

#[derive(Debug, Deserialize)]
struct GeminiContentResponse {
    parts: Vec<GeminiPartResponse>,
}

#[derive(Debug, Deserialize)]
struct GeminiPartResponse {
    text: String,
}

#[async_trait]
impl AiProvider for GeminiProvider {
    async fn suggest_category(&self, request: SuggestionRequest) -> Result<SuggestionResponse, ProviderError> {
        let mut url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent".to_string();
        
        if let Some(api_key) = &self.api_key {
            url = format!("{}?key={}", url, api_key);
        }

        let prompt = format!(
            "You are a financial assistant for 'mony', a personal finance tracker. \
             Categorize the following transaction description into one of our system categories. \
             Description: '{}'. Existing category (if any): '{}'. \
             Respond ONLY with a JSON object containing: 'category_key' (string), 'confidence' (float 0-1), 'reasoning' (string). \
             If you are unsure, provide your best guess with low confidence.",
            request.description,
            request.existing_category.unwrap_or_else(|| "none".to_string())
        );

        let body = GeminiRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart { text: prompt }],
            }],
        };

        let mut request_builder = self.client.post(&url);
        
        if let Some(token) = &self.token {
            request_builder = request_builder.bearer_auth(token);
        }

        let response = request_builder
            .json(&body)
            .send()
            .await?
            .json::<GeminiResponse>()
            .await?;

        let text = response.candidates
            .first()
            .ok_or_else(|| ProviderError::Api("No candidates returned".to_string()))?
            .content.parts.first()
            .ok_or_else(|| ProviderError::Api("No parts returned".to_string()))?
            .text.clone();

        // Extract JSON from the text (Gemini might wrap it in markdown)
        let json_str = if let Some(start) = text.find('{') {
            if let Some(end) = text.rfind('}') {
                &text[start..=end]
            } else {
                &text
            }
        } else {
            &text
        };

        let suggestion: SuggestionResponse = serde_json::from_str(json_str)?;
        Ok(suggestion)
    }
}
