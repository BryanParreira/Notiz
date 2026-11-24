use std::sync::Mutex;

use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_foundation::{NSActivityOptions, NSObjectProtocol, NSProcessInfo, NSString};

struct Activity(#[allow(dead_code)] Retained<ProtocolObject<dyn NSObjectProtocol>>);

// The token is only held to keep the activity alive and is never messaged.
unsafe impl Send for Activity {}

static ACTIVITY: Mutex<Option<Activity>> = Mutex::new(None);

// The app lives in the menu bar with every window hidden, which is exactly when
// macOS naps it and stretches timers to minutes. The countdown in the menu bar
// and the event alerts both run on timers, so they must keep firing on time.
// Idle system sleep stays allowed.
pub fn prevent_app_nap() {
    let Ok(mut guard) = ACTIVITY.lock() else {
        return;
    };
    if guard.is_some() {
        return;
    }

    let reason = NSString::from_str("Keeps the menu bar countdown and event alerts on time");
    let token = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
        NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
        &reason,
    );
    *guard = Some(Activity(token));
}
