//! Optional diagnostic logging for local development.

#[cfg(feature = "debug-logs")]
#[macro_export]
macro_rules! debug_log {
    ($($arg:tt)*) => {{
        anchor_lang::prelude::msg!($($arg)*);
    }};
}

#[cfg(not(feature = "debug-logs"))]
#[macro_export]
macro_rules! debug_log {
    ($($arg:tt)*) => {{
        // Keep log-only expressions type-checked and marked as used. The
        // constant branch is removed from release/SBF builds.
        if false {
            anchor_lang::prelude::msg!($($arg)*);
        }
    }};
}
