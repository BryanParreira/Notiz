use reqwest::header::CONTENT_TYPE;

pub(crate) struct AuthedHttp {
    client: reqwest::Client,
    base: &'static str,
    token: String,
}

impl AuthedHttp {
    pub(crate) fn new(base: &'static str, token: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            base,
            token,
        }
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> Result<Vec<u8>, notiz_http::Error> {
        let resp = req
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(Box::new)?;
        let status = resp.status();
        let bytes = resp.bytes().await.map_err(Box::new)?;
        if !status.is_success() {
            return Err(format!("calendar API returned {status}").into());
        }
        Ok(bytes.to_vec())
    }
}

impl notiz_http::HttpClient for AuthedHttp {
    async fn get(&self, path: &str) -> Result<Vec<u8>, notiz_http::Error> {
        self.send(self.client.get(format!("{}{path}", self.base)))
            .await
    }

    async fn post(
        &self,
        path: &str,
        body: Vec<u8>,
        content_type: &str,
    ) -> Result<Vec<u8>, notiz_http::Error> {
        self.send(
            self.client
                .post(format!("{}{path}", self.base))
                .header(CONTENT_TYPE, content_type)
                .body(body),
        )
        .await
    }

    async fn put(&self, path: &str, body: Vec<u8>) -> Result<Vec<u8>, notiz_http::Error> {
        self.send(
            self.client
                .put(format!("{}{path}", self.base))
                .header(CONTENT_TYPE, "application/json")
                .body(body),
        )
        .await
    }

    async fn patch(&self, path: &str, body: Vec<u8>) -> Result<Vec<u8>, notiz_http::Error> {
        self.send(
            self.client
                .patch(format!("{}{path}", self.base))
                .header(CONTENT_TYPE, "application/json")
                .body(body),
        )
        .await
    }

    async fn delete(&self, path: &str) -> Result<Vec<u8>, notiz_http::Error> {
        self.send(self.client.delete(format!("{}{path}", self.base)))
            .await
    }
}
