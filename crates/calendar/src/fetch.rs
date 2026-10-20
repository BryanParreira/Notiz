use notiz_calendar_interface::{CalendarProviderType, EventFilter};
use notiz_google_calendar::{
    CalendarListEntry as GoogleCalendar, Event as GoogleEvent, EventOrderBy, GoogleCalendarClient,
    ListEventsRequest as GoogleListEventsRequest,
};
use notiz_outlook_calendar::{
    Calendar as OutlookCalendar, Event as OutlookEvent,
    ListEventsRequest as OutlookListEventsRequest, OutlookCalendarClient,
};

use crate::error::Error;
use crate::http::AuthedHttp;
use crate::oauth;

const GOOGLE_API: &str = "https://www.googleapis.com";
const GRAPH_API: &str = "https://graph.microsoft.com/v1.0";
const PAGE_SIZE: u32 = 250;
const MAX_PAGES: usize = 20;

pub async fn list_google_calendars(connection_id: &str) -> Result<Vec<GoogleCalendar>, Error> {
    let token = oauth::access_token(CalendarProviderType::Google, connection_id).await?;
    let client = GoogleCalendarClient::new(AuthedHttp::new(GOOGLE_API, token));
    let response = client
        .list_calendars()
        .await
        .map_err(|e| Error::Api(e.to_string()))?;
    Ok(response.items)
}

pub async fn list_google_events(
    connection_id: &str,
    filter: EventFilter,
) -> Result<Vec<GoogleEvent>, Error> {
    let token = oauth::access_token(CalendarProviderType::Google, connection_id).await?;
    let client = GoogleCalendarClient::new(AuthedHttp::new(GOOGLE_API, token));

    let mut events = Vec::new();
    let mut page_token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let response = client
            .list_events(GoogleListEventsRequest {
                calendar_id: filter.calendar_tracking_id.clone(),
                time_min: Some(filter.from),
                time_max: Some(filter.to),
                max_results: Some(PAGE_SIZE),
                page_token: page_token.take(),
                single_events: Some(true),
                order_by: Some(EventOrderBy::StartTime),
                ..Default::default()
            })
            .await
            .map_err(|e| Error::Api(e.to_string()))?;

        events.extend(response.items);
        match response.next_page_token {
            Some(next) => page_token = Some(next),
            None => break,
        }
    }
    Ok(events)
}

pub async fn list_outlook_calendars(connection_id: &str) -> Result<Vec<OutlookCalendar>, Error> {
    let token = oauth::access_token(CalendarProviderType::Outlook, connection_id).await?;
    let client = OutlookCalendarClient::new(AuthedHttp::new(GRAPH_API, token));
    let response = client
        .list_calendars()
        .await
        .map_err(|e| Error::Api(e.to_string()))?;
    Ok(response.value)
}

pub async fn list_outlook_events(
    connection_id: &str,
    filter: EventFilter,
) -> Result<Vec<OutlookEvent>, Error> {
    let token = oauth::access_token(CalendarProviderType::Outlook, connection_id).await?;
    let client = OutlookCalendarClient::new(AuthedHttp::new(GRAPH_API, token));

    let mut events = Vec::new();
    let mut skip = 0u32;
    for _ in 0..MAX_PAGES {
        let response = client
            .list_events(OutlookListEventsRequest {
                calendar_id: filter.calendar_tracking_id.clone(),
                start_date_time: Some(filter.from),
                end_date_time: Some(filter.to),
                top: Some(PAGE_SIZE),
                skip: Some(skip),
                order_by: Some("start/dateTime".to_string()),
                ..Default::default()
            })
            .await
            .map_err(|e| Error::Api(e.to_string()))?;

        let count = response.value.len() as u32;
        events.extend(response.value);
        if count < PAGE_SIZE {
            break;
        }
        skip += count;
    }
    Ok(events)
}
