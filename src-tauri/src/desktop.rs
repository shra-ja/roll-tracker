//! Desktop IPC: narrow commands that return safe categories; request contexts stay native.
use crate::acquisition::mock::MockTransport;
pub use crate::acquisition::mock::Scenario;
use crate::acquisition::{
    AcquisitionError, CacheError, CachedRequest, Cancellable, Category, FetchFailure,
    HttpTransport, Paced, Progress, RequestContext, RetryBudget, Retrying, StopCheck, Transport,
    TransportError, extract_request_contexts, fetch_history, validate,
};
use crate::discovery::{
    ExtractionError,
    system::{DiscoveryError, extract_current_user_contexts},
};
use crate::storage::{
    self, Account, Filter, HistoryPage, LastImport, Preview, Rarities, Review, SavedAccount,
    Summary,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::{
    AppHandle, Builder, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder,
    ipc::{Channel, InvokeBody, Request},
};
use tokio_util::sync::CancellationToken;

pub mod database;
pub use database::Database;

/// Shared with `build.rs`, whose app manifest makes each command require a capability grant.
pub const COMMANDS: &[&str] = include!("desktop/commands.in");

/// Safe failure categories for the webview, sent as `{"kind": ..., "code"?: ...}`.
/// Paths, URLs, source text, credentials and response text never cross IPC.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "code", rename_all = "snake_case")]
pub enum Failure {
    UnsupportedHost,
    DiscoveryFailed,
    NoGameData,
    NoCache,
    NoRequest,
    FileTooLarge,
    InvalidFile,
    /// Every key was rejected and at least one had expired.
    ExpiredKey,
    /// Every key was rejected; the first nonzero API code.
    ApiError(i64),
    RateLimited,
    /// HoYoverse could not be reached, or a timeout or server error occurred.
    Network,
    Rejected,
    InvalidResponse,
    /// Nothing was sent, for example because no HTTPS client could be created.
    Internal,
    /// The user stopped the acquisition; nothing further was sent or kept.
    Cancelled,
    /// Retrieval needs a validated context; extract first.
    NoContext,
    /// The retrieved history exceeded the 16 MiB batch bound.
    HistoryTooLarge,
    /// Responses named more than one account or server.
    MixedAccounts,
    /// Records were retrieved, but no response named their server.
    MissingServer,
    /// The local database could not be opened, read or written.
    Storage,
    /// The stored account's context, such as its timezone, differs.
    ContextMismatch,
    /// A retrieved record differs from the stored one with the same ID.
    Conflict,
    /// Stored history changed after the preview; retrieve again.
    StalePreview,
    /// There is no retrieved history awaiting commit.
    NoPreview,
    /// A history request named an unknown category, page or page size.
    InvalidRequest,
}

/// A failure, with the category and page being requested when retrieval failed.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct RetrievalFailure {
    #[serde(flatten)]
    failure: Failure,
    #[serde(skip_serializing_if = "Option::is_none")]
    gacha_type: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page: Option<u32>,
}
impl From<Failure> for RetrievalFailure {
    /// A failure outside retrieval's requests, so without a location.
    fn from(failure: Failure) -> Self {
        Self {
            failure,
            gacha_type: None,
            page: None,
        }
    }
}

/// Retrieval progress for the webview: categories and counts only.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProgressEvent {
    Requesting {
        gacha_type: &'static str,
        page: u32,
        pages: usize,
        records: usize,
    },
    RetryPending {
        delay_ms: u64,
    },
    UpToDate {
        gacha_type: &'static str,
    },
}
impl From<Progress> for ProgressEvent {
    fn from(progress: Progress) -> Self {
        match progress {
            Progress::Requesting {
                category,
                page,
                pages,
                records,
            } => Self::Requesting {
                gacha_type: category.code(),
                page: page.get(),
                pages,
                records,
            },
            Progress::RetryPending { delay } => Self::RetryPending {
                delay_ms: delay.as_millis() as u64,
            },
            Progress::UpToDate { category } => Self::UpToDate {
                gacha_type: category.code(),
            },
        }
    }
}

/// What retrieval found: a review of the held preview, or no history at all.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Retrieved {
    Review(Review),
    NoHistory,
}

/// The current acquisition, held only in memory. Each extraction replaces it, and
/// a failed or cancelled one leaves no context.
#[derive(Default)]
pub struct Session {
    state: Mutex<Operation>,
}
#[derive(Default)]
struct Operation {
    /// Cancels the operation now running; each operation gets a new one.
    token: CancellationToken,
    /// The validated context and the retry budget its acquisition started, which
    /// retrieval continues with.
    acquisition: Option<(RequestContext, RetryBudget)>,
    /// The preview awaiting commit or discard. It holds no auth key.
    preview: Option<Preview>,
}
impl Session {
    fn state(&self) -> MutexGuard<'_, Operation> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
    /// Start an operation: stop any earlier one, so its late result cannot
    /// replace this one's, and drop the held context.
    fn begin(&self) -> CancellationToken {
        let mut state = self.state();
        state.token.cancel();
        state.token = CancellationToken::new();
        state.acquisition = None;
        state.preview = None;
        state.token.clone()
    }
    /// Start retrieval: stop any earlier operation and take the validated context,
    /// so the session holds no auth key from here on.
    fn take_validated(&self) -> Result<(CancellationToken, RequestContext, RetryBudget), Failure> {
        let mut state = self.state();
        state.token.cancel();
        state.token = CancellationToken::new();
        state.preview = None;
        let (context, budget) = state.acquisition.take().ok_or(Failure::NoContext)?;
        Ok((state.token.clone(), context, budget))
    }
    /// Hold a preview for commit or discard, unless its retrieval was cancelled.
    fn keep_preview(&self, token: &CancellationToken, preview: Preview) -> Result<(), Failure> {
        let mut state = self.state();
        if token.is_cancelled() {
            return Err(Failure::Cancelled);
        }
        state.preview = Some(preview);
        Ok(())
    }
    /// Keep a validated context, unless its operation was cancelled meanwhile.
    fn finish(
        &self,
        token: &CancellationToken,
        context: RequestContext,
        budget: RetryBudget,
    ) -> Result<(), Failure> {
        // Check under the lock that `cancel` takes, so no cancel can slip between.
        let mut state = self.state();
        if token.is_cancelled() {
            return Err(Failure::Cancelled);
        }
        state.acquisition = Some((context, budget));
        Ok(())
    }
    /// Take the held preview for commit; the session no longer holds it.
    fn take_preview(&self) -> Result<Preview, Failure> {
        self.state().preview.take().ok_or(Failure::NoPreview)
    }
    /// Drop the held preview, if any.
    fn discard(&self) {
        self.state().preview = None;
    }
    /// Stop the running operation and drop the held context.
    fn cancel(&self) {
        let mut state = self.state();
        state.token.cancel();
        state.acquisition = None;
        state.preview = None;
    }
}

/// Where history requests go: HoYoverse over HTTPS in the app, or the mock debug
/// binary's synthetic HoYoverse
/// ([decision 0014](../../docs/architecture/decisions/0014-mock-debug-binary.md)).
pub enum Network {
    Https,
    Mock(Scenario),
}
impl Network {
    /// A transport for one operation; the HTTPS client is built afresh each time.
    fn client(&self) -> Result<Client, Failure> {
        match self {
            Self::Https => HttpTransport::new()
                .map(Client::Https)
                .map_err(|_| Failure::Internal),
            Self::Mock(scenario) => Ok(Client::Mock(MockTransport::new(*scenario))),
        }
    }
}
/// The transport a command uses: one type, so each tested function has one
/// instantiation, which coverage scores as a whole.
enum Client {
    Https(HttpTransport),
    Mock(MockTransport),
}
impl Transport for Client {
    async fn get(&self, url: &str) -> Result<Vec<u8>, TransportError> {
        match self {
            Self::Https(transport) => transport.get(url).await,
            Self::Mock(transport) => transport.get(url).await,
        }
    }
}

// Separate from state management so tests can check commands fail safely without it.
fn handle_commands<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        extract_automatically,
        extract_from_file,
        cancel_acquisition,
        retrieve_history,
        commit_import,
        discard_import,
        history_page,
        last_import,
        saved_accounts
    ])
}

/// Register the desktop commands, their in-memory session and the local database,
/// which stays unopened until first used. Requests go to HoYoverse over HTTPS.
pub fn register<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    register_with(builder, Network::Https, database::FOLDER_NAME, true, false)
}

/// Register the app for the mock debug binary: requests go to a synthetic
/// HoYoverse, and history stays in its own folder, never in portable mode, so
/// synthetic history cannot mix with real history. Its webview profile is cleared
/// at each start, since a development webview can otherwise reuse modules cached
/// from an older dev server.
pub fn register_mock<R: Runtime>(builder: Builder<R>, scenario: Scenario) -> Builder<R> {
    register_with(
        builder,
        Network::Mock(scenario),
        database::MOCK_FOLDER_NAME,
        false,
        true,
    )
}

fn register_with<R: Runtime>(
    builder: Builder<R>,
    network: Network,
    folder_name: &'static str,
    portable: bool,
    fresh_webview: bool,
) -> Builder<R> {
    let builder = builder.manage(Session::default()).manage(network);
    handle_commands(builder).setup(move |app| {
        // Portable mode, or else local, not roaming, app data: history never
        // leaves the machine with a roaming Windows profile.
        let executable = std::env::current_exe().ok().filter(|_| portable);
        let local = app.path().local_data_dir().ok();
        let folder = database::location(
            executable.as_deref(),
            local.map(|local| local.join(folder_name)),
        );
        if let Some(folder) = folder.as_deref().filter(|_| fresh_webview) {
            database::clear_webview_profile(folder);
        }
        let opened = open_window(app.handle(), folder.as_deref());
        app.manage(Database::new(folder));
        opened.map_err(Into::into)
    })
}

/// Open the main window, keeping the webview's profile in the app's folder, so
/// portable mode leaves nothing of the app's behind on the machine.
fn open_window<R: Runtime>(app: &AppHandle<R>, folder: Option<&Path>) -> tauri::Result<()> {
    let mut window = size_overlay_for_development(WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::default(),
    ))
    .title("Astral Index")
    .inner_size(1000.0, 760.0)
    // The design's minimum, which excludes phones (decision 0013).
    .min_inner_size(480.0, 560.0);
    if let Some(folder) = folder {
        window = window.data_directory(database::webview_folder(folder));
    }
    window
        .build()
        .and_then(|window| zoom_for_development(&window))
}

/// Debug builds zoom the webview by `ASTRAL_INDEX_ZOOM`, when it holds a valid zoom.
#[cfg(debug_assertions)]
fn zoom_for_development<R: Runtime>(window: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    apply_dev_zoom(window, std::env::var(ZOOM_VARIABLE).ok().as_deref())
}
/// Release builds keep the webview's own zoom.
#[cfg(not(debug_assertions))]
fn zoom_for_development<R: Runtime>(_: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    Ok(())
}

/// Debug builds show the window's size over the page when `ASTRAL_INDEX_SIZE_OVERLAY`
/// is 1, for finding layout breaks by hand.
#[cfg(debug_assertions)]
fn size_overlay_for_development<'a, R: Runtime, M: Manager<R>>(
    window: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    with_size_overlay(window, std::env::var(SIZE_OVERLAY_VARIABLE).ok().as_deref())
}
/// Release builds never show it.
#[cfg(not(debug_assertions))]
fn size_overlay_for_development<'a, R: Runtime, M: Manager<R>>(
    window: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    window
}

/// Debug builds read the size overlay's switch from this variable.
#[cfg(debug_assertions)]
pub const SIZE_OVERLAY_VARIABLE: &str = "ASTRAL_INDEX_SIZE_OVERLAY";

/// The page script that asks the webview for the size overlay, when `value` is 1.
#[cfg(debug_assertions)]
fn size_overlay_script(value: Option<&str>) -> Option<&'static str> {
    (value == Some("1")).then_some("window.__ASTRAL_INDEX_SIZE_OVERLAY__ = true;")
}

/// Add the size overlay's page script to the window when `value` asks for it.
#[cfg(debug_assertions)]
fn with_size_overlay<'a, R: Runtime, M: Manager<R>>(
    window: WebviewWindowBuilder<'a, R, M>,
    value: Option<&str>,
) -> WebviewWindowBuilder<'a, R, M> {
    match size_overlay_script(value) {
        Some(script) => window.initialization_script(script),
        None => window,
    }
}

/// Debug builds read a webview zoom from this variable, so development under WSL,
/// which renders at 1x, can match the Windows display scale. Release builds ignore
/// it.
#[cfg(debug_assertions)]
pub const ZOOM_VARIABLE: &str = "ASTRAL_INDEX_ZOOM";

/// A zoom from 0.5 to 3, or none for anything else.
#[cfg(debug_assertions)]
fn dev_zoom(value: Option<&str>) -> Option<f64> {
    value?
        .parse::<f64>()
        .ok()
        .filter(|zoom| (0.5..=3.0).contains(zoom))
}

/// Zoom the window's webview when `value` is a valid zoom; otherwise leave it.
#[cfg(debug_assertions)]
fn apply_dev_zoom<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    value: Option<&str>,
) -> tauri::Result<()> {
    dev_zoom(value).map_or(Ok(()), |zoom| window.set_zoom(zoom))
}

impl From<ExtractionError> for Failure {
    fn from(error: ExtractionError) -> Self {
        match error {
            ExtractionError::Discovery(DiscoveryError::UnsupportedHost) => Self::UnsupportedHost,
            ExtractionError::Discovery(_) => Self::DiscoveryFailed,
            ExtractionError::NoGameData => Self::NoGameData,
            ExtractionError::NoCache => Self::NoCache,
            ExtractionError::NoRequest => Self::NoRequest,
        }
    }
}

impl From<FetchFailure> for Failure {
    fn from(failure: FetchFailure) -> Self {
        match failure {
            FetchFailure::ExpiredKey => Self::ExpiredKey,
            FetchFailure::Api(code) => Self::ApiError(code),
            FetchFailure::RateLimited => Self::RateLimited,
            FetchFailure::Transient => Self::Network,
            FetchFailure::Rejected(_) => Self::Rejected,
            FetchFailure::InvalidResponse => Self::InvalidResponse,
            FetchFailure::Internal => Self::Internal,
            FetchFailure::Cancelled => Self::Cancelled,
        }
    }
}

impl From<AcquisitionError> for Failure {
    fn from(error: AcquisitionError) -> Self {
        match error {
            AcquisitionError::Fetch(failure) => failure.into(),
            AcquisitionError::CursorCycle => Self::InvalidResponse,
            AcquisitionError::TooLarge => Self::HistoryTooLarge,
            AcquisitionError::MixedAccounts | AcquisitionError::MixedServers => Self::MixedAccounts,
            AcquisitionError::MissingServer => Self::MissingServer,
        }
    }
}

impl From<storage::Error> for Failure {
    fn from(error: storage::Error) -> Self {
        match error {
            storage::Error::Database
            | storage::Error::Schema
            | storage::Error::InvalidStoredData => Self::Storage,
            storage::Error::Context => Self::ContextMismatch,
            storage::Error::TooLarge => Self::HistoryTooLarge,
            storage::Error::Parse(_) => Self::InvalidResponse,
            storage::Error::Conflict => Self::Conflict,
            storage::Error::StalePreview => Self::StalePreview,
            // Retrieval previews only when records exist, so this is a defect.
            storage::Error::Empty => Self::Internal,
        }
    }
}

/// Validate the extracted requests and keep only the first working context
/// ([decision 0007](../../docs/architecture/decisions/0007-validate-during-extraction.md)).
/// The session is emptied first, so a failure at any step leaves no context, and
/// every cached URL is dropped when this returns.
async fn acquire(
    session: &Session,
    network: &Network,
    extracted: Result<Vec<CachedRequest>, Failure>,
) -> Result<(), Failure> {
    let token = session.begin();
    let requests = extracted?;
    let transport = network.client()?;
    validate_into(session, &transport, &token, requests).await
}

/// Validate over `transport`, retrying transient failures within a new
/// acquisition's budget, until done or cancelled.
async fn validate_into(
    session: &Session,
    transport: &(impl Transport + Sync),
    token: &CancellationToken,
    requests: Vec<CachedRequest>,
) -> Result<(), Failure> {
    let budget = RetryBudget::default();
    // Progress reaches the webview with the acquisition controls.
    let retrying = Retrying::new(transport, &budget, &|_| {});
    let paced = Paced::new(&retrying);
    let context = validate(&Cancellable::new(&paced, token), requests).await?;
    session.finish(token, context, budget)
}

// Bounded cache and log reads run synchronously on the async worker running this command.
async fn extract_into(session: &Session, network: &Network) -> Result<(), Failure> {
    acquire(
        session,
        network,
        extract_current_user_contexts().await.map_err(Failure::from),
    )
    .await
}

async fn extract_file_into(
    session: &Session,
    network: &Network,
    body: &InvokeBody,
) -> Result<(), Failure> {
    let extracted = match body {
        InvokeBody::Raw(bytes) => extract_request_contexts(bytes).map_err(|error| {
            if error == CacheError::TooLarge {
                Failure::FileTooLarge
            } else {
                Failure::NoRequest
            }
        }),
        InvokeBody::Json(_) => Err(Failure::InvalidFile),
    };
    acquire(session, network, extracted).await
}

/// Contacts HoYoverse to validate the extracted auth keys.
#[tauri::command]
async fn extract_automatically(
    session: State<'_, Session>,
    network: State<'_, Network>,
) -> Result<(), Failure> {
    extract_into(&session, &network).await
}

/// Stop the running extraction or acquisition and drop the held context.
#[tauri::command]
fn cancel_acquisition(session: State<'_, Session>) {
    session.cancel();
}

/// Retrieve every category from the validated context, continuing its retry
/// budget, and preview it. The auth key is dropped as soon as retrieval ends,
/// whatever the outcome; the session then holds only the preview.
async fn retrieve_into(
    session: &Session,
    database: &Database,
    transport: Result<&(impl Transport + Sync), Failure>,
    mode: &str,
    progress: &(dyn Fn(ProgressEvent) + Sync),
) -> Result<Retrieved, RetrievalFailure> {
    // A quick refresh stops at saved rolls; a full retrieval fetches everything.
    let quick = match mode {
        "new" => true,
        "full" => false,
        _ => return Err(Failure::InvalidRequest.into()),
    };
    let (token, context, budget) = session.take_validated()?;
    let transport = transport?;
    // Read before fetching, since the account is only known from the responses.
    let saved = if quick {
        Some(
            database
                .run(|store| store.saved_rolls())
                .await
                .and_then(|saved| saved)
                .map_err(Failure::from)?,
        )
    } else {
        None
    };
    let check = |uid: &str, server: &str, ids: &[&str]| {
        saved
            .as_ref()
            .is_some_and(|saved| saved.any(uid, server, ids.iter().copied()))
    };
    let stop: Option<StopCheck<'_>> = saved.is_some().then_some(&check);
    // The last page requested locates a retrieval failure.
    let requesting = Mutex::new(None);
    let report = |event: Progress| {
        if let Progress::Requesting { category, page, .. } = event {
            *requesting.lock().unwrap_or_else(PoisonError::into_inner) = Some((category, page));
        }
        progress(event.into());
    };
    let retrying = Retrying::new(transport, &budget, &report);
    let paced = Paced::new(&retrying);
    let fetched = fetch_history(&Cancellable::new(&paced, &token), &context, &report, stop).await;
    drop(context);
    let history = fetched.map_err(|error| {
        let location = requesting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        RetrievalFailure {
            failure: error.into(),
            gacha_type: location.map(|(category, _)| Category::code(category)),
            page: location.map(|(_, page)| page.get()),
        }
    })?;
    let Some(account) = history.account() else {
        return Ok(Retrieved::NoHistory);
    };
    let (uid, server) = (account.uid().to_owned(), account.server().to_owned());
    let preview = database
        .run(move |store| store.preview(&uid, &server, &history.responses()))
        .await
        .and_then(|preview| preview)
        .map_err(Failure::from)?;
    let review = preview.review().clone();
    session.keep_preview(&token, preview)?;
    Ok(Retrieved::Review(review))
}

/// Send progress to the webview; a closed webview is not an error.
fn forward(channel: &Channel<ProgressEvent>) -> impl Fn(ProgressEvent) + Sync + '_ {
    move |event| {
        let _ = channel.send(event);
    }
}

/// Commit the held preview, imported at `imported_at` (Unix seconds). The preview
/// is used up whatever the outcome; after a failure, retrieve again. A commit is
/// atomic and quick, so it is not cancellable.
async fn commit_into(
    session: &Session,
    database: &Database,
    imported_at: i64,
) -> Result<Summary, Failure> {
    let preview = session.take_preview()?;
    database
        .run(move |store| store.commit(preview, imported_at))
        .await
        .and_then(|summary| summary)
        .map_err(Failure::from)
}

/// Write the held preview to local history and return what it added.
#[tauri::command]
async fn commit_import(
    session: State<'_, Session>,
    database: State<'_, Database>,
) -> Result<Summary, Failure> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH);
    commit_into(
        &session,
        &database,
        now.map_or(0, |elapsed| elapsed.as_secs() as i64),
    )
    .await
}

/// The account an import last went into, with one page of its rolls in a category;
/// empty when nothing has been imported yet.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct StoredHistory {
    account: Option<Account>,
    #[serde(flatten)]
    page: HistoryPage,
}

/// The largest page the history list asks for.
const MAX_PAGE_SIZE: usize = 100;

/// The longest item search a history read accepts, in characters.
const MAX_SEARCH: usize = 100;

/// The longest UID or server name a history read accepts.
const MAX_ACCOUNT_FIELD: usize = 64;

/// The saved account a history read is for, as the account switcher names it.
/// Holds a player identifier: never log it.
#[derive(Deserialize)]
struct AccountKey {
    uid: String,
    server: String,
}

/// Which rolls a history read shows, as the webview names them; each part left
/// out shows them all.
#[derive(Default, Deserialize)]
struct FilterRequest {
    rarities: Option<Vec<String>>,
    search: Option<String>,
    from: Option<String>,
    to: Option<String>,
}

/// A server date as `YYYY-MM-DD`, if it names a real day in exactly that form.
fn date_of(text: &str) -> Option<String> {
    chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .ok()
        .filter(|date| date.format("%Y-%m-%d").to_string() == text)
        .map(|_| text.to_owned())
}

/// The filter a history read asked for, or none if any part of it is invalid.
fn filter_of(request: FilterRequest) -> Option<Filter> {
    let name = request.search.unwrap_or_default();
    if name.chars().count() > MAX_SEARCH {
        return None;
    }
    let date = |text: Option<String>| match text {
        Some(text) => date_of(&text).map(Some),
        None => Some(None),
    };
    Some(Filter {
        rarities: rarities_of(request.rarities)?,
        name,
        from: date(request.from)?,
        to: date(request.to)?,
    })
}

/// The rarities a history read shows: every one unless some are named, each as
/// "5", "4" or "3". None for anything else.
fn rarities_of(named: Option<Vec<String>>) -> Option<Rarities> {
    let Some(named) = named else {
        return Some(Rarities::ALL);
    };
    if named.len() > 3 {
        return None;
    }
    let mut rarities = Rarities {
        five: false,
        four: false,
        three: false,
    };
    for rank in named {
        match rank.as_str() {
            "5" => rarities.five = true,
            "4" => rarities.four = true,
            "3" => rarities.three = true,
            _ => return None,
        }
    }
    Some(rarities)
}

/// Read one page of saved history: of `account` when named, otherwise of the
/// account imported into last, showing only the rolls `filter` asks for. The
/// request is checked before the database is opened; nothing is ever requested
/// from HoYoverse.
async fn history_into(
    database: &Database,
    account: Option<AccountKey>,
    filter: Option<FilterRequest>,
    category: &str,
    page: usize,
    page_size: usize,
) -> Result<StoredHistory, Failure> {
    let category = Category::ALL
        .into_iter()
        .find(|candidate| candidate.code() == category);
    let offset = page
        .checked_sub(1)
        .and_then(|before| before.checked_mul(page_size));
    let (Some(category), Some(offset), Some(filter), 1..=MAX_PAGE_SIZE) = (
        category,
        offset,
        filter_of(filter.unwrap_or_default()),
        page_size,
    ) else {
        return Err(Failure::InvalidRequest);
    };
    let field = |value: &str| (1..=MAX_ACCOUNT_FIELD).contains(&value.len());
    if account
        .as_ref()
        .is_some_and(|key| !field(&key.uid) || !field(&key.server))
    {
        return Err(Failure::InvalidRequest);
    }
    database
        .run(move |store| {
            let found = match &account {
                Some(key) => match store.account(&key.uid, &key.server)? {
                    Some(found) => Some(found),
                    // Only saved accounts are offered, so another is not a request to honour.
                    None => return Ok(Err(Failure::InvalidRequest)),
                },
                None => store.latest_account()?,
            };
            let Some(account) = found else {
                return Ok(Ok(StoredHistory {
                    account: None,
                    page: HistoryPage::empty(),
                }));
            };
            let page = store.page(
                &account.uid,
                &account.server,
                category,
                &filter,
                offset,
                page_size,
            )?;
            Ok(Ok(StoredHistory {
                account: Some(account),
                page,
            }))
        })
        .await
        .and_then(|history| history)
        .map_err(Failure::from)?
}

/// Stored history only: never contacts HoYoverse.
#[tauri::command]
async fn history_page(
    database: State<'_, Database>,
    category: String,
    page: usize,
    page_size: usize,
    account: Option<AccountKey>,
    filter: Option<FilterRequest>,
) -> Result<StoredHistory, Failure> {
    history_into(&database, account, filter, &category, page, page_size).await
}

/// The game's saved accounts with their roll totals, the one imported into last
/// first. Never contacts HoYoverse.
async fn saved_accounts_into(database: &Database) -> Result<Vec<SavedAccount>, Failure> {
    database
        .run(|store| store.accounts())
        .await
        .and_then(|accounts| accounts)
        .map_err(Failure::from)
}

/// Stored history only: never contacts HoYoverse.
#[tauri::command]
async fn saved_accounts(database: State<'_, Database>) -> Result<Vec<SavedAccount>, Failure> {
    saved_accounts_into(&database).await
}

/// The newest import's summary; none before the first. Never contacts HoYoverse.
async fn last_import_into(database: &Database) -> Result<Option<LastImport>, Failure> {
    database
        .run(|store| store.last_import())
        .await
        .and_then(|last| last)
        .map_err(Failure::from)
}

/// Stored history only: never contacts HoYoverse.
#[tauri::command]
async fn last_import(database: State<'_, Database>) -> Result<Option<LastImport>, Failure> {
    last_import_into(&database).await
}

/// Drop the held preview without writing anything.
#[tauri::command]
fn discard_import(session: State<'_, Session>) {
    session.discard();
}

/// Contacts HoYoverse to retrieve history, streaming progress to `on_progress`.
#[tauri::command]
async fn retrieve_history(
    session: State<'_, Session>,
    database: State<'_, Database>,
    network: State<'_, Network>,
    mode: String,
    on_progress: Channel<ProgressEvent>,
) -> Result<Retrieved, RetrievalFailure> {
    let transport = network.client();
    let transport = transport.as_ref().map_err(Clone::clone);
    retrieve_into(
        &session,
        &database,
        transport,
        &mode,
        &forward(&on_progress),
    )
    .await
}

/// The webview sends the selected file's bytes as a raw body; no path crosses IPC.
/// Contacts HoYoverse to validate the extracted auth keys.
#[tauri::command]
async fn extract_from_file(
    request: Request<'_>,
    session: State<'_, Session>,
    network: State<'_, Network>,
) -> Result<(), Failure> {
    extract_file_into(&session, &network, request.body()).await
}

#[cfg(test)]
mod tests {
    pub(crate) mod blocking;
    mod events;
    use super::*;
    use crate::acquisition::TransportError;
    use crate::acquisition::tests::{filesystem, http, scripted::Scripted};
    use crate::acquisition::{MAX_CACHE_BYTES, REQUEST_INTERVAL};
    use crate::discovery::system::tests::os;
    use crate::storage::tests::database::{self as sql, Reply};
    use crate::storage::tests::{
        accounts_row, accounts_script, commit_script, found, last_import_row, last_import_step,
        latest_row, latest_step, lookup, page_rows, page_script, preview, preview_script,
        saved_rolls_script, setup, stale_commit_script, step, text, timezone,
    };
    use rusqlite::types::Value;
    use std::path::PathBuf;
    use tauri::{
        Manager, WebviewWindow, WebviewWindowBuilder,
        ipc::CallbackFn,
        test::{
            INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
        },
        webview::InvokeRequest,
    };

    const ENDPOINT: &str = "https://public-operation-hkrpg-sg.hoyoverse.com/common/hkrpg_gacha_record/api/getGachaLog?";
    const PAGE: &[u8] = include_bytes!("../tests/fixtures/hsr-api/page.json");

    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .start_paused(true)
            .build()
            .unwrap()
            .block_on(future)
    }
    fn url(key: &str) -> String {
        format!("{ENDPOINT}authkey={key}&authkey_ver=1&sign_type=2&game_biz=hkrpg_global&lang=en")
    }
    /// A cache holding `keys`; validation tries them in reverse order.
    fn cache(keys: &[&str]) -> Vec<u8> {
        keys.iter()
            .flat_map(|key| format!("1/0/{}\0", url(key)).into_bytes())
            .collect()
    }
    fn context(key: &str) -> RequestContext {
        extract_request_contexts(&cache(&[key]))
            .unwrap()
            .remove(0)
            .into_context()
    }
    /// Script HoYoverse's responses to validation requests, each an HTTP 200 body.
    fn respond(bodies: &[&[u8]]) {
        http::install(http::Fixture {
            responses: bodies
                .iter()
                .map(|body| {
                    Ok(http::Plan {
                        status: 200,
                        chunks: vec![Ok(body.to_vec())],
                    })
                })
                .collect(),
            ..Default::default()
        });
    }
    const EXPIRED: &[u8] = br#"{"retcode":-101,"message":"synthetic","data":null}"#;
    fn requested() -> Vec<String> {
        http::inspect(|state| state.requested.clone())
    }
    fn window() -> WebviewWindow<MockRuntime> {
        let mut app = register(mock_builder())
            .build(mock_context(noop_assets()))
            .unwrap();
        // Run the setup hook, which manages the database and opens the window
        // (see the registration test).
        #[allow(deprecated)]
        app.run_iteration(events::ignore);
        app.get_webview_window("main").unwrap()
    }
    // IPC commands run on Tauri's worker threads, which cannot see the thread-local
    // doubles; IPC tests therefore cover only failures before any request.
    fn invoke(
        window: &WebviewWindow<MockRuntime>,
        cmd: &str,
        body: InvokeBody,
    ) -> Result<(), String> {
        get_ipc_response(
            window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body,
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    }
    fn held(session: &Session) -> Option<(RequestContext, RetryBudget)> {
        session.state().acquisition.take()
    }
    fn stored(session: &Session) -> Option<RequestContext> {
        held(session).map(|(context, _)| context)
    }
    fn raw(bytes: Vec<u8>) -> InvokeBody {
        InvokeBody::Raw(bytes)
    }

    /// The window icon Tauri compiles in is the Astral tile (decision 0023): the
    /// 512 px icon, the emblem's colour at its centre and the tile's at its edge.
    #[test]
    fn the_window_icon_is_the_astral_tile() {
        let context: tauri::Context<MockRuntime> = tauri::generate_context!();
        let icon = context.default_window_icon().expect("a window icon");
        assert_eq!((icon.width(), icon.height()), (512, 512));
        let pixel = |x: usize, y: usize| &icon.rgba()[(y * 512 + x) * 4..][..4];
        assert_eq!(pixel(256, 256), [0xfa, 0xf9, 0xf5, 255]);
        assert_eq!(pixel(40, 256), [0x20, 0x27, 0x35, 255]);
        assert_eq!(pixel(0, 0), [0, 0, 0, 0]);
    }

    #[test]
    fn registers_exactly_the_manifest_commands_and_rejects_others() {
        let window = window();
        assert_eq!(
            COMMANDS,
            [
                "extract_automatically",
                "extract_from_file",
                "cancel_acquisition",
                "retrieve_history",
                "commit_import",
                "discard_import",
                "history_page",
                "last_import",
                "saved_accounts"
            ]
        );
        assert_eq!(
            invoke(&window, COMMANDS[8], InvokeBody::default()),
            Err(r#"{"kind":"storage"}"#.into())
        );
        // The test doubles can't serve worker threads, so the read fails safely.
        assert_eq!(
            invoke(&window, COMMANDS[7], InvokeBody::default()),
            Err(r#"{"kind":"storage"}"#.into())
        );
        // History requests are checked before any database access, and need every argument.
        for (body, argument) in [
            (serde_json::json!({}), "category"),
            (serde_json::json!({ "category": "11" }), "page"),
            (
                serde_json::json!({ "category": "11", "page": 1 }),
                "pageSize",
            ),
        ] {
            let missing = invoke(&window, COMMANDS[6], InvokeBody::Json(body));
            assert!(missing.unwrap_err().contains(argument));
        }
        let request = serde_json::json!({ "category": "99", "page": 1, "pageSize": 20 });
        assert_eq!(
            invoke(&window, COMMANDS[6], InvokeBody::Json(request)),
            Err(r#"{"kind":"invalid_request"}"#.into())
        );
        // A filter, when named, is an object of the expected parts.
        for filter in [
            serde_json::json!(5),
            serde_json::json!({ "rarities": "5" }),
            serde_json::json!({ "search": 5 }),
            serde_json::json!({ "from": 20240101 }),
        ] {
            let request = serde_json::json!({
                "category": "11", "page": 1, "pageSize": 20, "filter": filter,
            });
            let malformed = invoke(&window, COMMANDS[6], InvokeBody::Json(request));
            assert!(malformed.unwrap_err().contains("filter"));
        }
        // A filter's parts are checked before the database is opened.
        let request = serde_json::json!({
            "category": "11", "page": 1, "pageSize": 20, "filter": { "to": "2024-13-01" },
        });
        assert_eq!(
            invoke(&window, COMMANDS[6], InvokeBody::Json(request)),
            Err(r#"{"kind":"invalid_request"}"#.into())
        );
        // An account, when named, needs both its UID and server.
        let request = serde_json::json!({
            "category": "11", "page": 1, "pageSize": 20, "account": { "uid": "100000002" },
        });
        let missing = invoke(&window, COMMANDS[6], InvokeBody::Json(request));
        assert!(missing.unwrap_err().contains("server"));
        let request = serde_json::json!({
            "category": "11", "page": 1, "pageSize": 20, "account": { "uid": "", "server": "x" },
        });
        assert_eq!(
            invoke(&window, COMMANDS[6], InvokeBody::Json(request)),
            Err(r#"{"kind":"invalid_request"}"#.into())
        );
        // Nothing was retrieved, so there is nothing to commit; discarding is harmless.
        assert_eq!(
            invoke(&window, COMMANDS[4], InvokeBody::default()),
            Err(r#"{"kind":"no_preview"}"#.into())
        );
        assert_eq!(invoke(&window, COMMANDS[5], InvokeBody::default()), Ok(()));
        assert_eq!(invoke(&window, COMMANDS[2], InvokeBody::default()), Ok(()));
        // Retrieval needs a known mode; nothing was validated, so it sends nothing.
        let channel =
            |mode: &str| serde_json::json!({ "onProgress": "__CHANNEL__:1", "mode": mode });
        assert_eq!(
            invoke(&window, COMMANDS[3], InvokeBody::Json(channel("full"))),
            Err(r#"{"kind":"no_context"}"#.into())
        );
        assert_eq!(
            invoke(&window, COMMANDS[3], InvokeBody::Json(channel("partial"))),
            Err(r#"{"kind":"invalid_request"}"#.into())
        );
        let missing = serde_json::json!({ "onProgress": "__CHANNEL__:1" });
        let missing = invoke(&window, COMMANDS[3], InvokeBody::Json(missing));
        assert!(missing.unwrap_err().contains("mode"));
        // Host discovery is unsupported here: the unit-test OS double reports plain Linux.
        assert_eq!(
            invoke(&window, COMMANDS[0], InvokeBody::default()),
            Err(r#"{"kind":"unsupported_host"}"#.into())
        );
        assert_eq!(
            invoke(&window, COMMANDS[1], InvokeBody::default()),
            Err(r#"{"kind":"invalid_file"}"#.into())
        );
        assert_eq!(
            invoke(&window, COMMANDS[1], raw(b"no request".to_vec())),
            Err(r#"{"kind":"no_request"}"#.into())
        );
        // A progress channel is required.
        let no_channel = InvokeBody::Json(serde_json::json!({ "mode": "full" }));
        let missing = invoke(&window, COMMANDS[3], no_channel);
        assert!(missing.unwrap_err().contains("onProgress"));
        let unknown = invoke(&window, "read_arbitrary_file", InvokeBody::default());
        assert!(unknown.unwrap_err().contains("not found"));
        assert_eq!(stored(&window.state::<Session>()), None);
    }

    #[test]
    fn registration_opens_the_window_with_its_data_in_the_named_local_folder() {
        let mut app = register(mock_builder())
            .build(mock_context(noop_assets()))
            .unwrap();
        // Tauri runs setup hooks on the event loop's first event; with the mock
        // runtime, only this deprecated call runs them. It is called once here.
        #[allow(deprecated)]
        app.run_iteration(events::ignore);
        let folder = app.path().local_data_dir().unwrap().join("astral-index");
        assert_eq!(
            app.state::<Database>().path(),
            Some(folder.join(database::FILE_NAME))
        );
        assert!(app.get_webview_window("main").is_some());
        // The app keeps its webview profile.
        filesystem::inspect(|state| assert!(state.removed.is_empty()));
    }

    #[test]
    fn the_mock_app_keeps_its_own_data_folder_and_network() {
        let mut app = register_mock(mock_builder(), Scenario::History)
            .build(mock_context(noop_assets()))
            .unwrap();
        #[allow(deprecated)]
        app.run_iteration(events::ignore);
        let folder = app
            .path()
            .local_data_dir()
            .unwrap()
            .join(database::MOCK_FOLDER_NAME);
        assert_eq!(
            app.state::<Database>().path(),
            Some(folder.join(database::FILE_NAME))
        );
        assert!(matches!(
            *app.state::<Network>(),
            Network::Mock(Scenario::History)
        ));
        assert!(app.get_webview_window("main").is_some());
        // The mock starts each run with a fresh webview profile.
        filesystem::inspect(|state| {
            assert_eq!(state.removed, [database::webview_profile(&folder)]);
        });
    }

    #[test]
    fn the_mock_network_validates_and_serves_history_without_any_request() {
        http::install(Default::default());
        let session = Session::default();
        let network = Network::Mock(Scenario::History);
        assert_eq!(
            run(extract_file_into(
                &session,
                &network,
                &raw(cache(&["synthetic"]))
            )),
            Ok(())
        );
        let client = network.client().unwrap();
        let history = run(fetch_history(&client, &context("synthetic"), &|_| {}, None)).unwrap();
        assert_eq!(history.account().unwrap().uid(), "100000001");
        let expired = Network::Mock(Scenario::ExpiredLink);
        assert_eq!(
            run(extract_file_into(
                &session,
                &expired,
                &raw(cache(&["synthetic"]))
            )),
            Err(Failure::ExpiredKey)
        );
        assert!(requested().is_empty());
    }

    #[test]
    fn a_development_zoom_is_a_number_from_half_to_three() {
        assert_eq!(ZOOM_VARIABLE, "ASTRAL_INDEX_ZOOM");
        assert_eq!(dev_zoom(Some("1.25")), Some(1.25));
        assert_eq!(dev_zoom(Some("0.5")), Some(0.5));
        assert_eq!(dev_zoom(Some("3")), Some(3.0));
        for ignored in [
            None,
            Some(""),
            Some("large"),
            Some("0.4"),
            Some("3.5"),
            Some("-1"),
            Some("NaN"),
            Some("inf"),
        ] {
            assert_eq!(dev_zoom(ignored), None, "{ignored:?}");
        }
    }

    #[test]
    fn the_window_takes_a_development_zoom_and_ignores_anything_else() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        open_window(app.handle(), None).unwrap();
        let window = app.get_webview_window("main").unwrap();
        for value in [Some("1.25"), Some("large"), None] {
            assert!(apply_dev_zoom(&window, value).is_ok());
        }
    }

    #[test]
    fn a_size_overlay_is_requested_only_by_one() {
        assert_eq!(SIZE_OVERLAY_VARIABLE, "ASTRAL_INDEX_SIZE_OVERLAY");
        assert_eq!(
            size_overlay_script(Some("1")),
            Some("window.__ASTRAL_INDEX_SIZE_OVERLAY__ = true;")
        );
        for ignored in [None, Some(""), Some("0"), Some("true"), Some(" 1")] {
            assert_eq!(size_overlay_script(ignored), None, "{ignored:?}");
        }
    }

    #[test]
    fn the_window_opens_with_or_without_a_size_overlay() {
        for value in [Some("1"), None] {
            let app = mock_builder().build(mock_context(noop_assets())).unwrap();
            let window = WebviewWindowBuilder::new(app.handle(), "main", WebviewUrl::default());
            assert!(with_size_overlay(window, value).build().is_ok());
        }
    }

    #[test]
    fn the_window_opens_even_without_a_data_folder() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        open_window(app.handle(), None).unwrap();
        assert!(app.get_webview_window("main").is_some());
    }

    #[test]
    fn database_commands_fail_safely_without_a_managed_database() {
        // Built without running setup, so no database is managed.
        let app = register(mock_builder())
            .build(mock_context(noop_assets()))
            .unwrap();
        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let channel = serde_json::json!({ "onProgress": "__CHANNEL__:1" });
        let error = invoke(&window, "retrieve_history", InvokeBody::Json(channel));
        assert!(error.unwrap_err().contains("state not managed"));
        let error = invoke(&window, "commit_import", InvokeBody::default());
        assert!(error.unwrap_err().contains("state not managed"));
    }

    #[test]
    fn commands_fail_safely_without_a_managed_session() {
        let app = handle_commands(mock_builder())
            .build(mock_context(noop_assets()))
            .unwrap();
        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        for command in COMMANDS {
            let error = invoke(&window, command, raw(cache(&["synthetic"])));
            assert!(error.unwrap_err().contains("state not managed"));
        }
    }

    #[test]
    fn requesting_commands_fail_safely_without_a_managed_network() {
        let app = handle_commands(mock_builder().manage(Session::default()))
            .build(mock_context(noop_assets()))
            .unwrap();
        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        for command in ["extract_automatically", "extract_from_file"] {
            let error = invoke(&window, command, raw(cache(&["synthetic"])));
            assert!(error.unwrap_err().contains("state not managed"));
        }
    }

    #[test]
    fn failures_cross_ipc_as_kinds_with_only_an_api_code() {
        for (failure, json) in [
            (Failure::ExpiredKey, r#"{"kind":"expired_key"}"#),
            (
                Failure::ApiError(-100),
                r#"{"kind":"api_error","code":-100}"#,
            ),
            (Failure::Network, r#"{"kind":"network"}"#),
        ] {
            assert_eq!(serde_json::to_string(&failure).unwrap(), json);
        }
    }

    #[test]
    fn file_extraction_keeps_only_the_first_validated_context() {
        respond(&[EXPIRED, PAGE]);
        let session = Session::default();
        let body = raw(cache(&["untried", "valid", "expired"]));
        assert_eq!(
            run(extract_file_into(&session, &Network::Https, &body)),
            Ok(())
        );
        assert_eq!(requested(), [url("expired"), url("valid")]);
        assert_eq!(stored(&session), Some(context("valid")));
    }

    #[test]
    fn validation_retries_transient_failures_within_the_budget() {
        let status = |status: u16, body: &[u8]| {
            Ok(http::Plan {
                status,
                chunks: vec![Ok(body.to_vec())],
            })
        };
        http::install(http::Fixture {
            responses: [
                status(503, b""),
                status(200, EXPIRED),
                status(503, b""),
                status(200, PAGE),
            ]
            .into(),
            ..Default::default()
        });
        let session = Session::default();
        let body = raw(cache(&["valid", "expired"]));
        assert_eq!(
            run(extract_file_into(&session, &Network::Https, &body)),
            Ok(())
        );
        assert_eq!(
            requested(),
            [url("expired"), url("expired"), url("valid"), url("valid")]
        );
        // Retrieval continues with what validation left of the budget.
        let (context_held, budget) = held(&session).unwrap();
        assert_eq!(context_held, context("valid"));
        assert_eq!(budget.remaining(), 0);
    }

    const EMPTY: &[u8] = br#"{"retcode":0,"message":"OK","data":{"region":"synthetic-server","region_time_zone":8,"list":[]}}"#;
    /// Hold a validated context with the given budget, as extraction leaves it.
    fn validated(session: &Session, budget: RetryBudget) {
        let token = session.begin();
        session.finish(&token, context("valid"), budget).unwrap();
    }
    fn database() -> Database {
        filesystem::install(Default::default());
        Database::new(Some(PathBuf::from("/data")))
    }
    fn opening() -> Vec<sql::Step> {
        let mut steps = vec![step(
            "OPEN",
            vec![text("/data/history.sqlite")],
            Reply::Done,
        )];
        steps.extend(setup(true));
        steps
    }
    /// The fixture page answers the first category, then an empty page ends it and
    /// each of the rest.
    fn pages() -> Vec<Result<Vec<u8>, TransportError>> {
        let mut pages = vec![Ok(PAGE.to_vec())];
        pages.extend((0..6).map(|_| Ok(EMPTY.to_vec())));
        pages
    }
    /// Discard progress in tests that do not check it.
    fn ignore(_: ProgressEvent) {}
    fn json(value: impl Serialize) -> serde_json::Value {
        serde_json::to_value(value).unwrap()
    }
    /// Whether the session holds a validated context, and a preview.
    fn holds(session: &Session) -> (bool, bool) {
        let state = session.state();
        (state.acquisition.is_some(), state.preview.is_some())
    }

    #[test]
    fn retrieval_previews_every_category_and_holds_only_the_preview() {
        let session = Session::default();
        validated(&session, RetryBudget::default());
        let database = database();
        let mut script = opening();
        script.extend(preview_script());
        sql::expect(script);
        // The first request fails transiently and is retried within the budget.
        let mut responses = vec![Err(TransportError::Status(503))];
        responses.extend(pages());
        let transport = Serving::new(responses);
        let events = std::sync::Mutex::new(Vec::new());
        let report = |event| events.lock().unwrap().push(event);
        let retrieved = run(retrieve_into(
            &session,
            &database,
            Ok(&transport),
            "full",
            &report,
        ));
        sql::finish();
        let review = json(retrieved.unwrap());
        assert_eq!(review["kind"], "review");
        assert_eq!(review["uid"], "100000002");
        assert_eq!(review["summary"]["inserted"], 2);
        assert_eq!(transport.requested().len(), 8);
        let events = events.into_inner().unwrap();
        assert_eq!(events[1], ProgressEvent::RetryPending { delay_ms: 1000 });
        assert_eq!(
            [events[0].clone(), events[2].clone(), events[3].clone()],
            [
                ProgressEvent::Requesting {
                    gacha_type: "1",
                    page: 1,
                    pages: 0,
                    records: 0
                },
                ProgressEvent::Requesting {
                    gacha_type: "1",
                    page: 2,
                    pages: 1,
                    records: 2
                },
                ProgressEvent::Requesting {
                    gacha_type: "2",
                    page: 1,
                    pages: 2,
                    records: 2
                },
            ]
        );
        // The auth key is gone; only the preview remains, until cancelled.
        assert_eq!(holds(&session), (false, true));
        session.cancel();
        assert_eq!(holds(&session), (false, false));
    }

    #[test]
    fn a_retrieval_mode_other_than_new_or_full_is_refused_before_anything_is_taken() {
        let session = Session::default();
        validated(&session, RetryBudget::default());
        let transport = Serving::new(vec![]);
        sql::expect(vec![]);
        let failure = run(retrieve_into(
            &session,
            &database(),
            Ok(&transport),
            "partial",
            &ignore,
        ));
        sql::finish();
        assert_eq!(failure.err().unwrap(), Failure::InvalidRequest.into());
        assert!(transport.requested().is_empty());
        // The validated context is still held for a correct request.
        assert_eq!(holds(&session), (true, false));
    }

    #[test]
    fn a_quick_refresh_stops_each_category_at_saved_rolls() {
        let session = Session::default();
        validated(&session, RetryBudget::default());
        let database = database();
        // The fixture page's first roll is saved for its account, so Stellar ends
        // with that page instead of requesting an empty one.
        let saved_id = page_rows()[0][0].clone();
        let mut script = opening();
        script.extend(saved_rolls_script(vec![vec![
            text("100000002"),
            text("synthetic-server"),
            saved_id,
        ]]));
        script.extend(preview_script());
        sql::expect(script);
        let transport = Serving::new(pages());
        let events = std::sync::Mutex::new(Vec::new());
        let report = |event| events.lock().unwrap().push(event);
        let retrieved = run(retrieve_into(
            &session,
            &database,
            Ok(&transport),
            "new",
            &report,
        ));
        sql::finish();
        assert_eq!(json(retrieved.unwrap())["kind"], "review");
        assert_eq!(transport.requested().len(), 6);
        let events = events.into_inner().unwrap();
        assert_eq!(events[1], ProgressEvent::UpToDate { gacha_type: "1" });
        assert_eq!(holds(&session), (false, true));
    }

    #[test]
    fn a_quick_refresh_that_cannot_read_saved_rolls_sends_nothing() {
        let session = Session::default();
        validated(&session, RetryBudget::default());
        let mut script = opening();
        script.extend(saved_rolls_script(vec![vec![Value::Null]]));
        sql::expect(script);
        let transport = Serving::new(vec![]);
        let failure = run(retrieve_into(
            &session,
            &database(),
            Ok(&transport),
            "new",
            &ignore,
        ));
        sql::finish();
        assert_eq!(failure.err().unwrap(), Failure::Storage.into());
        assert!(transport.requested().is_empty());
        assert_eq!(holds(&session), (false, false));
    }

    #[test]
    fn no_records_means_no_history_and_no_database_access() {
        let session = Session::default();
        validated(&session, RetryBudget::default());
        let database = database();
        let transport = Serving::new((0..6).map(|_| Ok(EMPTY.to_vec())).collect());
        let retrieved = run(retrieve_into(
            &session,
            &database,
            Ok(&transport),
            "full",
            &ignore,
        ));
        assert_eq!(
            json(retrieved.unwrap()),
            serde_json::json!({ "kind": "no_history" })
        );
        filesystem::inspect(|state| assert!(state.accessed.is_empty()));
        assert_eq!(holds(&session), (false, false));
    }

    #[test]
    fn validation_and_retrieval_pause_before_each_request() {
        let session = Session::default();
        let transport = Serving::new(vec![Ok(EXPIRED.to_vec()), Ok(EMPTY.to_vec())]);
        let requests = extract_request_contexts(&cache(&["valid", "expired"])).unwrap();
        let token = session.begin();
        let validating = run(async {
            let started = tokio::time::Instant::now();
            validate_into(&session, &transport, &token, requests)
                .await
                .unwrap();
            started.elapsed()
        });
        assert_eq!(validating, REQUEST_INTERVAL * 2);
        let transport = Serving::new((0..6).map(|_| Ok(EMPTY.to_vec())).collect());
        let database = database();
        let retrieving = run(async {
            let started = tokio::time::Instant::now();
            retrieve_into(&session, &database, Ok(&transport), "full", &ignore)
                .await
                .unwrap();
            started.elapsed()
        });
        assert_eq!(retrieving, REQUEST_INTERVAL * 6);
    }

    #[test]
    fn a_failed_retrieval_reports_where_it_failed_and_drops_the_key() {
        let session = Session::default();
        validated(&session, RetryBudget::default());
        let transport = Serving::new(vec![Ok(EMPTY.to_vec()), Ok(EXPIRED.to_vec())]);
        let failure = run(retrieve_into(
            &session,
            &database(),
            Ok(&transport),
            "full",
            &ignore,
        ));
        assert_eq!(
            json(failure.err().unwrap()),
            serde_json::json!({ "kind": "expired_key", "gacha_type": "2", "page": 1 })
        );
        assert_eq!(holds(&session), (false, false));
    }

    #[test]
    fn retrieval_needs_a_validated_context_and_a_client() {
        let session = Session::default();
        let transport = Serving::new(vec![]);
        let failure = run(retrieve_into(
            &session,
            &database(),
            Ok(&transport),
            "full",
            &ignore,
        ));
        assert_eq!(failure.err().unwrap(), Failure::NoContext.into());
        // A missing HTTPS client still ends retrieval, dropping the key.
        validated(&session, RetryBudget::default());
        let failure = run(retrieve_into(
            &session,
            &database(),
            Err::<&Serving, _>(Failure::Internal),
            "full",
            &ignore,
        ));
        assert_eq!(failure.err().unwrap(), Failure::Internal.into());
        assert_eq!(holds(&session), (false, false));
        assert!(transport.requested().is_empty());
    }

    #[test]
    fn a_database_failure_after_retrieval_has_no_location() {
        let session = Session::default();
        validated(&session, RetryBudget::default());
        let database = database();
        let mut failing = opening().remove(0);
        failing.reply = Err(rusqlite::Error::InvalidQuery);
        sql::expect(vec![failing]);
        let transport = Serving::new(pages());
        let failure = run(retrieve_into(
            &session,
            &database,
            Ok(&transport),
            "full",
            &ignore,
        ));
        sql::finish();
        assert_eq!(failure.err().unwrap(), Failure::Storage.into());
        assert_eq!(holds(&session), (false, false));
    }

    #[test]
    fn cancelling_stops_retrieval_and_keeps_no_preview() {
        let session = Session::default();
        validated(&session, RetryBudget::default());
        let transport = Serving::cancelling(&session, 1, pages());
        let failure = run(retrieve_into(
            &session,
            &database(),
            Ok(&transport),
            "full",
            &ignore,
        ));
        assert_eq!(json(failure.err().unwrap())["kind"], "cancelled");
        assert_eq!(transport.requested().len(), 1);
        // A preview finished after cancelling is not kept.
        let token = session.begin();
        session.cancel();
        assert_eq!(
            session.keep_preview(&token, preview()),
            Err(Failure::Cancelled)
        );
        assert_eq!(holds(&session), (false, false));
    }

    #[test]
    fn retrieval_continues_the_budget_validation_left() {
        // Validation spent both retries.
        let budget = RetryBudget::default();
        let spend = Serving::new(vec![
            Err(TransportError::Timeout),
            Ok(vec![]),
            Err(TransportError::Timeout),
            Ok(vec![]),
        ]);
        run(async {
            let retrying = Retrying::new(&spend, &budget, &|_| {});
            retrying.get("a").await.unwrap();
            retrying.get("b").await.unwrap();
        });
        let session = Session::default();
        validated(&session, budget);
        let transport = Serving::new(vec![Err(TransportError::Status(503))]);
        let failure = run(retrieve_into(
            &session,
            &database(),
            Ok(&transport),
            "full",
            &ignore,
        ));
        assert_eq!(
            json(failure.err().unwrap()),
            serde_json::json!({ "kind": "network", "gacha_type": "1", "page": 1 })
        );
        assert_eq!(transport.requested().len(), 1);
    }

    #[test]
    fn progress_reaches_the_webview_as_categories_and_counts() {
        let sent = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let received = std::sync::Arc::clone(&sent);
        let channel = Channel::new(move |body| {
            let event: serde_json::Value = body.deserialize().unwrap();
            received.lock().unwrap().push(event);
            Ok(())
        });
        forward(&channel)(ProgressEvent::from(Progress::RetryPending {
            delay: std::time::Duration::from_secs(1),
        }));
        assert_eq!(
            *sent.lock().unwrap(),
            [serde_json::json!({ "kind": "retry_pending", "delay_ms": 1000 })]
        );
        let requesting = ProgressEvent::from(Progress::Requesting {
            category: Category::LightConeEvent,
            page: std::num::NonZeroU32::new(3).unwrap(),
            pages: 4,
            records: 3000,
        });
        assert_eq!(
            json(requesting),
            serde_json::json!({ "kind": "requesting", "gacha_type": "12", "page": 3, "pages": 4, "records": 3000 })
        );
        let up_to_date = ProgressEvent::from(Progress::UpToDate {
            category: Category::CharacterCollaboration,
        });
        assert_eq!(
            json(up_to_date),
            serde_json::json!({ "kind": "up_to_date", "gacha_type": "21" })
        );
    }

    #[test]
    fn retrieval_and_storage_errors_map_to_safe_categories() {
        for (error, failure) in [
            (
                AcquisitionError::Fetch(FetchFailure::ExpiredKey),
                Failure::ExpiredKey,
            ),
            (AcquisitionError::CursorCycle, Failure::InvalidResponse),
            (AcquisitionError::TooLarge, Failure::HistoryTooLarge),
            (AcquisitionError::MixedAccounts, Failure::MixedAccounts),
            (AcquisitionError::MixedServers, Failure::MixedAccounts),
            (AcquisitionError::MissingServer, Failure::MissingServer),
        ] {
            assert_eq!(Failure::from(error), failure);
        }
        for (error, failure) in [
            (storage::Error::Database, Failure::Storage),
            (storage::Error::Schema, Failure::Storage),
            (storage::Error::InvalidStoredData, Failure::Storage),
            (storage::Error::Context, Failure::ContextMismatch),
            (storage::Error::TooLarge, Failure::HistoryTooLarge),
            (
                storage::Error::Parse(crate::ParseError::InvalidRecord),
                Failure::InvalidResponse,
            ),
            (storage::Error::Conflict, Failure::Conflict),
            (storage::Error::StalePreview, Failure::StalePreview),
            (storage::Error::Empty, Failure::Internal),
        ] {
            assert_eq!(Failure::from(error), failure);
        }
    }

    /// Hold a preview of one new record, as retrieval leaves it.
    fn previewed(session: &Session) {
        let token = session.begin();
        session.keep_preview(&token, preview()).unwrap();
    }

    #[test]
    fn commit_writes_the_held_preview_and_uses_it_up() {
        let session = Session::default();
        previewed(&session);
        let database = database();
        let mut script = opening();
        script.extend(commit_script(false));
        sql::expect(script);
        let summary = run(commit_into(&session, &database, 1234)).unwrap();
        sql::finish();
        assert_eq!(
            json(summary),
            serde_json::json!({ "inserted": 1, "duplicates": 0, "conflicts": 0 })
        );
        assert_eq!(holds(&session), (false, false));
        // Nothing is left to commit.
        assert_eq!(
            run(commit_into(&session, &database, 1234)),
            Err(Failure::NoPreview)
        );
    }

    #[test]
    fn a_refused_commit_writes_nothing_and_uses_up_the_preview() {
        let session = Session::default();
        previewed(&session);
        let database = database();
        let mut script = opening();
        script.extend(stale_commit_script());
        sql::expect(script);
        assert_eq!(
            run(commit_into(&session, &database, 1234)),
            Err(Failure::StalePreview)
        );
        sql::finish();
        assert_eq!(holds(&session), (false, false));
        // A database that cannot be opened is a storage failure.
        previewed(&session);
        let mut failing = opening().remove(0);
        failing.reply = Err(rusqlite::Error::InvalidQuery);
        sql::expect(vec![failing]);
        assert_eq!(
            run(commit_into(
                &session,
                &Database::new(Some(PathBuf::from("/data"))),
                1234
            )),
            Err(Failure::Storage)
        );
        sql::finish();
    }

    #[test]
    fn discarding_drops_the_preview_without_writing() {
        let session = Session::default();
        previewed(&session);
        sql::expect(vec![]);
        session.discard();
        sql::finish();
        assert_eq!(holds(&session), (false, false));
        session.discard();
        assert_eq!(holds(&session), (false, false));
    }

    #[test]
    fn cancel_stops_the_running_operation_and_drops_the_context() {
        let session = Session::default();
        let token = session.begin();
        session
            .finish(&token, context("valid"), RetryBudget::default())
            .unwrap();
        session.cancel();
        assert!(token.is_cancelled());
        assert_eq!(stored(&session), None);
    }

    #[test]
    fn a_cancelled_or_superseded_operation_keeps_no_late_result() {
        let session = Session::default();
        let token = session.begin();
        session.cancel();
        assert_eq!(
            session.finish(&token, context("late"), RetryBudget::default()),
            Err(Failure::Cancelled)
        );
        assert_eq!(stored(&session), None);
        // Starting another operation stops the earlier one.
        let earlier = session.begin();
        let later = session.begin();
        assert!(earlier.is_cancelled());
        assert!(!later.is_cancelled());
        assert_eq!(
            session.finish(&earlier, context("earlier"), RetryBudget::default()),
            Err(Failure::Cancelled)
        );
        assert_eq!(stored(&session), None);
    }

    /// Serves scripted responses; with a count, cancels the session as it serves
    /// that many. One transport type keeps each tested function to one
    /// instantiation, which coverage scores as a whole.
    struct Serving<'a> {
        scripted: Scripted,
        cancel: Option<(&'a Session, std::sync::Mutex<usize>)>,
    }
    impl<'a> Serving<'a> {
        fn new(responses: Vec<Result<Vec<u8>, TransportError>>) -> Self {
            Self {
                scripted: Scripted::new(responses),
                cancel: None,
            }
        }
        fn cancelling(
            session: &'a Session,
            after: usize,
            responses: Vec<Result<Vec<u8>, TransportError>>,
        ) -> Self {
            Self {
                scripted: Scripted::new(responses),
                cancel: Some((session, after.into())),
            }
        }
        fn requested(&self) -> Vec<String> {
            self.scripted.requested()
        }
    }
    impl Transport for Serving<'_> {
        async fn get(&self, url: &str) -> Result<Vec<u8>, TransportError> {
            let response = self.scripted.get(url).await;
            if let Some((session, left)) = &self.cancel {
                let mut left = left.lock().unwrap();
                *left -= 1;
                if *left == 0 {
                    session.cancel();
                }
            }
            response
        }
    }

    #[test]
    fn a_preview_finished_after_cancelling_is_not_kept() {
        let session = Session::default();
        validated(&session, RetryBudget::default());
        let database = database();
        let mut script = opening();
        script.extend(preview_script());
        sql::expect(script);
        // The last response still arrives, so the preview is built, then refused.
        let transport = Serving::cancelling(&session, 7, pages());
        let failure = run(retrieve_into(
            &session,
            &database,
            Ok(&transport),
            "full",
            &ignore,
        ));
        sql::finish();
        assert_eq!(failure.err().unwrap(), Failure::Cancelled.into());
        assert_eq!(holds(&session), (false, false));
    }

    #[test]
    fn cancelling_during_validation_sends_no_further_request() {
        let session = Session::default();
        let transport = Serving::cancelling(&session, 1, vec![Ok(EXPIRED.to_vec())]);
        let requests = extract_request_contexts(&cache(&["valid", "expired"])).unwrap();
        let token = session.begin();
        assert_eq!(
            run(validate_into(&session, &transport, &token, requests)),
            Err(Failure::Cancelled)
        );
        assert_eq!(transport.requested(), [url("expired")]);
        assert_eq!(stored(&session), None);
    }

    #[test]
    fn failed_extraction_or_validation_leaves_no_context() {
        let session = Session::default();
        let earlier = || {
            let token = session.begin();
            session
                .finish(&token, context("earlier"), RetryBudget::default())
                .unwrap();
        };
        for (body, failure) in [
            (raw(b"no request".to_vec()), Failure::NoRequest),
            (raw(vec![0; MAX_CACHE_BYTES + 1]), Failure::FileTooLarge),
            (InvokeBody::default(), Failure::InvalidFile),
        ] {
            http::install(Default::default());
            earlier();
            assert_eq!(
                run(extract_file_into(&session, &Network::Https, &body)),
                Err(failure)
            );
            assert_eq!(stored(&session), None);
            assert!(requested().is_empty());
        }
        respond(&[EXPIRED]);
        earlier();
        assert_eq!(
            run(extract_file_into(
                &session,
                &Network::Https,
                &raw(cache(&["synthetic"]))
            )),
            Err(Failure::ExpiredKey)
        );
        assert_eq!(stored(&session), None);
        http::install(http::Fixture {
            build_error: true,
            ..Default::default()
        });
        earlier();
        assert_eq!(
            run(extract_file_into(
                &session,
                &Network::Https,
                &raw(cache(&["synthetic"]))
            )),
            Err(Failure::Internal)
        );
        assert_eq!(stored(&session), None);
        assert!(requested().is_empty());
    }

    #[test]
    fn automatic_extraction_validates_discovered_contexts() {
        os::install(os::Fixture {
            distro: Some("Synthetic".into()),
            plans: [
                os::Plan::output("C:\\Users\\Example\\AppData\\Roaming"),
                os::Plan::output("/windows/c/Users/Example/AppData/Roaming\n"),
                os::Plan::output("/volumes/games/Star Rail\n"),
            ]
            .into(),
            ..Default::default()
        });
        filesystem::install(filesystem::Fixture {
            files: [
                (
                    PathBuf::from(
                        "/windows/c/Users/Example/AppData/LocalLow/Cognosphere/Star Rail/Player.log",
                    ),
                    b"Loading player data from D:/Games/Star Rail/data.unity3d\n".to_vec(),
                ),
                (
                    PathBuf::from("/volumes/games/Star Rail/webCaches/3.0.0.0/Cache/Cache_Data/data_2"),
                    cache(&["discovered"]),
                ),
            ]
            .into(),
            listings: [(
                PathBuf::from("/volumes/games/Star Rail/webCaches"),
                vec![PathBuf::from("/volumes/games/Star Rail/webCaches/3.0.0.0")],
            )]
            .into(),
            ..Default::default()
        });
        respond(&[PAGE]);
        let session = Session::default();
        assert_eq!(run(extract_into(&session, &Network::Https)), Ok(()));
        assert_eq!(requested(), [url("discovered")]);
        assert_eq!(stored(&session), Some(context("discovered")));
    }

    #[test]
    fn errors_map_to_safe_categories() {
        for (error, failure) in [
            (
                ExtractionError::Discovery(DiscoveryError::UnsupportedHost),
                Failure::UnsupportedHost,
            ),
            (
                ExtractionError::Discovery(DiscoveryError::TimedOut),
                Failure::DiscoveryFailed,
            ),
            (ExtractionError::NoGameData, Failure::NoGameData),
            (ExtractionError::NoCache, Failure::NoCache),
            (ExtractionError::NoRequest, Failure::NoRequest),
        ] {
            assert_eq!(Failure::from(error), failure);
        }
        for (fetch, failure) in [
            (FetchFailure::ExpiredKey, Failure::ExpiredKey),
            (FetchFailure::Api(-100), Failure::ApiError(-100)),
            (FetchFailure::RateLimited, Failure::RateLimited),
            (FetchFailure::Transient, Failure::Network),
            (FetchFailure::Rejected(302), Failure::Rejected),
            (FetchFailure::InvalidResponse, Failure::InvalidResponse),
            (FetchFailure::Internal, Failure::Internal),
            (FetchFailure::Cancelled, Failure::Cancelled),
        ] {
            assert_eq!(Failure::from(fetch), failure);
        }
    }

    #[test]
    fn history_requests_are_checked_before_the_database_is_opened() {
        let database = database();
        sql::expect(vec![]);
        for (category, page, size) in [
            ("99", 1, 20),
            ("11", 0, 20),
            ("11", 1, 0),
            ("11", 1, 101),
            ("11", usize::MAX, 100),
        ] {
            assert_eq!(
                run(history_into(&database, None, None, category, page, size)),
                Err(Failure::InvalidRequest)
            );
        }
        // Named rarities must each be 5, 4 or 3, at most three of them; a search is
        // at most 100 characters, whatever their size in bytes; and each date is a
        // real day written as YYYY-MM-DD.
        let invalid = [
            asking(Some(&["6"]), None, None, None),
            asking(Some(&["5", "four"]), None, None, None),
            asking(Some(&["5", "4", "3", "5"]), None, None, None),
            asking(None, Some(&"é".repeat(101)), None, None),
            asking(None, None, Some("2024-02-30"), None),
            asking(None, None, Some("2024-2-1"), None),
            asking(None, None, None, Some("yesterday")),
        ];
        for filter in invalid {
            assert_eq!(
                run(history_into(&database, None, Some(filter), "11", 1, 20)),
                Err(Failure::InvalidRequest)
            );
        }
        // A named account must have a UID and server of at most 64 bytes each.
        let long = "1".repeat(65);
        for (uid, server) in [
            ("", "synthetic-server"),
            ("100000002", ""),
            (long.as_str(), "synthetic-server"),
            ("100000002", long.as_str()),
        ] {
            let account = AccountKey {
                uid: uid.into(),
                server: server.into(),
            };
            assert_eq!(
                run(history_into(&database, Some(account), None, "11", 1, 20)),
                Err(Failure::InvalidRequest)
            );
        }
        sql::finish();
        assert_eq!(
            json(Failure::InvalidRequest),
            serde_json::json!({ "kind": "invalid_request" })
        );
    }

    #[test]
    fn history_reads_a_page_of_the_latest_account() {
        let database = database();
        let mut script = opening();
        script.push(latest_step(vec![latest_row()]));
        script.extend(page_script(found(&[
            "9007199254740993",
            "9007199254740992",
        ])));
        sql::expect(script);
        let history = run(history_into(&database, None, None, "11", 2, 2)).unwrap();
        sql::finish();
        let history = json(history);
        assert_eq!(
            history["account"],
            serde_json::json!({ "uid": "100000002", "server": "synthetic-server", "timezone": 8 })
        );
        assert_eq!(history["total"], 5);
        assert_eq!(
            history["categories"],
            serde_json::json!([
                { "gacha_type": "1", "total": 3 },
                { "gacha_type": "2", "total": 0 },
                { "gacha_type": "11", "total": 5 },
                { "gacha_type": "12", "total": 0 },
                { "gacha_type": "21", "total": 0 },
                { "gacha_type": "22", "total": 0 },
            ])
        );
        assert_eq!(
            history["summary"],
            serde_json::json!({
                "five_star": 2, "four_star": 2,
                "first": "2024-01-01 00:00:00", "last": "2024-03-02 10:00:00",
            })
        );
        assert_eq!(history["rolls"][0]["number"], 3);
        assert_eq!(history["rolls"][1]["id"], "9007199254740992");
    }

    fn chosen() -> Option<AccountKey> {
        Some(AccountKey {
            uid: "100000002".into(),
            server: "synthetic-server".into(),
        })
    }

    #[test]
    fn history_reads_a_page_of_the_chosen_account() {
        let database = database();
        let mut script = opening();
        script.push(timezone(Some(Some(8))));
        script.extend(page_script(found(&[
            "9007199254740993",
            "9007199254740992",
        ])));
        sql::expect(script);
        let history = json(run(history_into(&database, chosen(), None, "11", 2, 2)).unwrap());
        sql::finish();
        assert_eq!(
            history["account"],
            serde_json::json!({ "uid": "100000002", "server": "synthetic-server", "timezone": 8 })
        );
        assert_eq!(history["total"], 5);
        assert_eq!(history["rolls"][1]["id"], "9007199254740992");
        // An account that isn't saved is not shown as an empty history.
        sql::expect(vec![timezone(None)]);
        assert_eq!(
            run(history_into(&database, chosen(), None, "11", 1, 20)),
            Err(Failure::InvalidRequest)
        );
        sql::finish();
        // A damaged offset is a storage failure.
        sql::expect(vec![step(
            "SELECT timezone FROM accounts WHERE game=?1 AND uid=?2 AND server=?3",
            vec![
                text("honkai-star-rail"),
                text("100000002"),
                text("synthetic-server"),
            ],
            Reply::Rows(vec![Ok(vec![text("8")])]),
        )]);
        assert_eq!(
            run(history_into(&database, chosen(), None, "11", 1, 20)),
            Err(Failure::Storage)
        );
        sql::finish();
    }

    /// A filter as the webview would send it.
    fn asking(
        rarities: Option<&[&str]>,
        search: Option<&str>,
        from: Option<&str>,
        to: Option<&str>,
    ) -> FilterRequest {
        FilterRequest {
            rarities: rarities.map(|named| named.iter().map(|rank| (*rank).to_owned()).collect()),
            search: search.map(String::from),
            from: from.map(String::from),
            to: to.map(String::from),
        }
    }

    #[test]
    fn history_shows_only_the_rolls_the_filter_asks_for() {
        let database = database();
        // The database is opened on the first read only.
        let mut script = opening();
        for (filter, shown) in [
            (
                asking(Some(&["5"]), None, None, None),
                vec!["9007199254740993", "9007199254740992"],
            ),
            (
                asking(Some(&["3", "4"]), None, None, None),
                vec!["9007199254740995", "9007199254740994", "9007199254740989"],
            ),
            (asking(Some(&[]), None, None, None), vec![]),
            (
                asking(None, Some(" ÉCLAIR "), None, None),
                vec!["9007199254740995"],
            ),
            (
                asking(Some(&["5", "4", "3"]), Some("pe"), None, None),
                vec!["9007199254740994"],
            ),
            (
                asking(None, None, Some("2024-02-29"), Some("2024-03-01")),
                vec!["9007199254740994", "9007199254740993", "9007199254740992"],
            ),
            (
                asking(None, None, None, Some("2024-01-01")),
                vec!["9007199254740989"],
            ),
            (
                FilterRequest::default(),
                vec![
                    "9007199254740995",
                    "9007199254740994",
                    "9007199254740993",
                    "9007199254740992",
                    "9007199254740989",
                ],
            ),
        ] {
            script.push(latest_step(vec![latest_row()]));
            script.extend(page_script(found(&shown)));
            sql::expect(std::mem::take(&mut script));
            let history =
                json(run(history_into(&database, None, Some(filter), "11", 1, 20)).unwrap());
            sql::finish();
            assert_eq!(
                (history["total"].clone(), history["matched"].clone()),
                (5.into(), shown.len().into())
            );
        }
    }

    #[test]
    fn without_an_account_history_is_empty_and_damage_is_a_storage_failure() {
        let database = database();
        let mut script = opening();
        script.push(latest_step(vec![]));
        sql::expect(script);
        let empty = ["1", "2", "11", "12", "21", "22"]
            .map(|code| serde_json::json!({ "gacha_type": code, "total": 0 }));
        assert_eq!(
            json(run(history_into(&database, None, None, "1", 1, 20)).unwrap()),
            serde_json::json!({
                "account": null, "total": 0, "matched": 0, "soft_pity": null,
                "categories": empty,
                "summary": { "five_star": 0, "four_star": 0, "first": null, "last": null },
                "rolls": [],
            })
        );
        sql::finish();
        sql::expect(vec![latest_step(vec![vec![Value::Null]])]);
        assert_eq!(
            run(history_into(&database, None, None, "11", 1, 20)),
            Err(Failure::Storage)
        );
        sql::finish();
        let mut script = vec![latest_step(vec![latest_row()])];
        script.extend(page_script(vec![lookup("9007199254740993", Some("{"))]));
        sql::expect(script);
        assert_eq!(
            run(history_into(&database, None, None, "11", 2, 2)),
            Err(Failure::Storage)
        );
        sql::finish();
    }

    #[test]
    fn saved_accounts_are_read_from_storage_only() {
        let database = database();
        let mut script = opening();
        script.extend(accounts_script(vec![accounts_row()]));
        sql::expect(script);
        assert_eq!(
            json(run(saved_accounts_into(&database)).unwrap()),
            serde_json::json!([
                { "uid": "100000002", "server": "synthetic-server", "timezone": 8, "rolls": 15 },
            ])
        );
        sql::finish();
        sql::expect(accounts_script(vec![]));
        assert_eq!(
            json(run(saved_accounts_into(&database)).unwrap()),
            serde_json::json!([])
        );
        sql::finish();
        sql::expect(accounts_script(vec![vec![Value::Null]]));
        assert_eq!(run(saved_accounts_into(&database)), Err(Failure::Storage));
        sql::finish();
    }

    #[test]
    fn the_last_import_is_read_from_storage_only() {
        let database = database();
        let mut script = opening();
        script.push(last_import_step(vec![last_import_row()]));
        sql::expect(script);
        assert_eq!(
            json(run(last_import_into(&database)).unwrap()),
            serde_json::json!({
                "imported_at": 1_790_000_000, "source": "hoyoverse",
                "uid": "100000002", "server": "synthetic-server", "inserted": 96,
            })
        );
        sql::finish();
        sql::expect(vec![last_import_step(vec![])]);
        assert_eq!(run(last_import_into(&database)), Ok(None));
        sql::finish();
        sql::expect(vec![last_import_step(vec![vec![Value::Null]])]);
        assert_eq!(run(last_import_into(&database)), Err(Failure::Storage));
        sql::finish();
    }
}
